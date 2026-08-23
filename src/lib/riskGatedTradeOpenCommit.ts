import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPeriodOutcomeSnapshot,
  RiskPolicyVersion,
} from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import {
  validatePendingFingerprint,
  type PendingTradeOpenRequest,
  type TradeOpenRiskGateState,
} from '@/lib/tradeOpenRiskGate'
import {
  isRevisionedStorageAdapter,
  StorageRevisionConflictError,
  type StorageAdapter,
} from '@/storage/adapter'
import {
  flushStorageBeforeCutover,
  lockStorageCutoverInteraction,
} from '@/storage/cutover'
import {
  discardPendingAndResumePersist,
  resumePersist,
  suspendPersist,
} from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import type { PersistedSnapshot } from '@/storage/types'
import { getCurrentLiveStage } from '@/lib/liveStages'

export interface RiskGateCommitState {
  trades: Trade[]
  currentLiveStageId: string
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  display: { tradingDayStartHour: number }
}

export interface CommitRiskGatedTradeOpenInput<State extends RiskGateCommitState> {
  request: PendingTradeOpenRequest
  reason: string
  captureLatestState: () => {
    state: State
    snapshot: PersistedSnapshot
    currentTradingDayKey: string
  }
  publish: (state: State) => void
  storage?: StorageAdapter
  now?: () => string
  createActivityId?: () => string
  createEventId?: () => string
}

export type RiskGatedTradeOpenCommitResult =
  | { kind: 'committed' }
  | { kind: 'cancelled'; reason: 'target-missing' | 'target-no-longer-eligible' }
  | { kind: 'needs-reconfirmation' }

export class RiskGatePublishAfterCommitError extends Error {
  readonly code = 'risk-gate-publish-after-commit'
  readonly durablyCommitted = true
  readonly requiresStorageReload = true

  constructor(
    readonly committedSnapshot: PersistedSnapshot,
    readonly cause: unknown,
  ) {
    super('风险开仓已写入存储，但内存状态发布失败；必须从 storage 重新载入')
    this.name = 'RiskGatePublishAfterCommitError'
    Object.freeze(this)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  const canonicalize = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(canonicalize)
    if (!isRecord(nested)) return nested
    return Object.fromEntries(
      Object.keys(nested)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
        .filter((key) => nested[key] !== undefined)
        .map((key) => [key, canonicalize(nested[key])]),
    )
  }
  return JSON.stringify(canonicalize(value))
}

function clonePlainData<T>(value: T): T {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) return value
  if (typeof value !== 'object') throw new Error('持久化候选只能包含 plain data')
  if (Array.isArray(value)) return value.map((item) => clonePlainData(item)) as T
  if (!isRecord(value)) throw new Error('持久化候选只能包含 plain data')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('持久化候选只能包含 plain data')
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, clonePlainData(nested)]),
  ) as T
}

function freezePlainData<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezePlainData(nested)
  Object.freeze(value)
  return value
}

function durableSnapshot(candidate: PersistedSnapshot): PersistedSnapshot {
  return freezePlainData(clonePlainData(candidate))
}

function publishStateFromDurable<State extends RiskGateCommitState>(
  candidate: State,
  durable: PersistedSnapshot,
): State {
  return {
    ...candidate,
    trades: clonePlainData(durable.trades),
    riskPolicyVersions: clonePlainData(durable.riskPolicyVersions),
    monthlyRiskLimits: clonePlainData(durable.monthlyRiskLimits),
    riskOverrideEvents: clonePlainData(durable.riskOverrideEvents),
  }
}

function sameCanonicalSnapshot(
  left: PersistedSnapshot | null,
  right: PersistedSnapshot,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right)
}

function stateMatchesSnapshot(state: RiskGateCommitState, snapshot: PersistedSnapshot): boolean {
  return canonicalJson({
    trades: state.trades,
    currentLiveStageId: state.currentLiveStageId,
    riskPolicyVersions: state.riskPolicyVersions,
    monthlyRiskLimits: state.monthlyRiskLimits,
    riskOverrideEvents: state.riskOverrideEvents,
    tradingDayStartHour: state.display.tradingDayStartHour,
  }) === canonicalJson({
    trades: snapshot.trades,
    currentLiveStageId: snapshot.currentLiveStageId,
    riskPolicyVersions: snapshot.riskPolicyVersions,
    monthlyRiskLimits: snapshot.monthlyRiskLimits,
    riskOverrideEvents: snapshot.riskOverrideEvents,
    tradingDayStartHour: snapshot.display.tradingDayStartHour,
  })
}

function cloneRiskOutcome(outcome: RiskPeriodOutcomeSnapshot): RiskPeriodOutcomeSnapshot {
  return { ...outcome, unknownReasons: [...outcome.unknownReasons] }
}

function freezeRiskOverrideEvent(event: RiskOverrideEvent): RiskOverrideEvent {
  Object.freeze(event.tradeIdentityAtDecision)
  for (const outcome of Object.values(event.outcomesAtDecision)) {
    Object.freeze(outcome.unknownReasons)
    Object.freeze(outcome)
  }
  Object.freeze(event.outcomesAtDecision)
  Object.freeze(event.unknownReasons)
  Object.freeze(event)
  return event
}

function buildOpenedSnapshot<State extends RiskGateCommitState>(
  baseline: {
    state: State
    snapshot: PersistedSnapshot
    currentTradingDayKey: string
  },
  request: PendingTradeOpenRequest,
  reason: string,
  options: Pick<
    CommitRiskGatedTradeOpenInput<State>,
    'now' | 'createActivityId' | 'createEventId'
  >,
): { state: State; snapshot: PersistedSnapshot } {
  const trade = baseline.state.trades.find((item) => item.id === request.tradeId)
  if (!trade) throw new Error('待确认交易不存在')
  const timestamp = options.now?.() ?? new Date().toISOString()
  if (!isCanonicalIsoInstant(timestamp)) throw new Error('风险确认时间必须是合法 ISO 时间')
  const activityId = options.createActivityId?.() ?? `activity-open-${trade.id}-${timestamp}`
  const eventId = options.createEventId?.() ?? `risk-override-${trade.id}-${timestamp}`
  if (!activityId.trim() || !eventId.trim()) throw new Error('风险确认审计 ID 不能为空')
  if (trade.activities?.some((activity) => activity.id === activityId)) {
    throw new Error('open activity ID 已存在')
  }
  if (baseline.state.riskOverrideEvents.some((event) => event.id === eventId)) {
    throw new Error('risk override event ID 已存在')
  }

  const opened: Trade = {
    ...trade,
    status: 'open',
    closedAt: null,
    closedTradingDayKey: undefined,
    missReason: undefined,
    activities: [...(trade.activities ?? []), {
      id: activityId,
      kind: 'status',
      status: 'open',
      timestamp,
    }],
  }
  const event = freezeRiskOverrideEvent({
    id: eventId,
    liveStageId: baseline.state.currentLiveStageId,
    tradeId: trade.id,
    tradeIdentityAtDecision: {
      ref: trade.ref,
      symbol: trade.symbol,
      tradeKind: 'live',
    },
    linkState: 'resolved',
    decisionType: request.decisionType,
    tradingDayKeyAtDecision: request.currentTradingDayKey,
    policyVersionId: request.policyVersionId,
    createdAt: timestamp,
    reason,
    fingerprint: request.fingerprint,
    outcomesAtDecision: {
      day: cloneRiskOutcome(request.outcomes.day),
      week: cloneRiskOutcome(request.outcomes.week),
      month: cloneRiskOutcome(request.outcomes.month),
    },
    unknownReasons: [...request.unknownReasons],
  })
  const trades = baseline.state.trades.map((item) => item.id === trade.id ? opened : item)
  const stateRiskOverrideEvents = [...baseline.state.riskOverrideEvents, event]
  const snapshotRiskOverrideEvents = [...baseline.snapshot.riskOverrideEvents, event]
  return {
    state: { ...baseline.state, trades, riskOverrideEvents: stateRiskOverrideEvents },
    snapshot: { ...baseline.snapshot, trades, riskOverrideEvents: snapshotRiskOverrideEvents },
  }
}

export async function commitRiskGatedTradeOpen<State extends RiskGateCommitState>(
  input: CommitRiskGatedTradeOpenInput<State>,
): Promise<RiskGatedTradeOpenCommitResult> {
  const reason = input.reason.trim()
  if (Array.from(reason).length > 500) throw new Error('风险覆盖原因最多 500 字')
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let durablyCommitted = false
  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true
    const baseline = input.captureLatestState()
    if (!stateMatchesSnapshot(baseline.state, baseline.snapshot)) {
      return { kind: 'needs-reconfirmation' }
    }
    const currentStage = getCurrentLiveStage(
      baseline.snapshot.liveStages,
      baseline.state.currentLiveStageId,
    )
    const gateState: TradeOpenRiskGateState = {
      trades: baseline.state.trades,
      riskPolicyVersions: baseline.state.riskPolicyVersions,
      monthlyRiskLimits: baseline.state.monthlyRiskLimits,
      currentLiveStageId: currentStage.id,
      currentLiveStageStartsOn: currentStage.startsOn,
      currentTradingDayKey: baseline.currentTradingDayKey,
      tradingDayStartHour: baseline.state.display.tradingDayStartHour,
    }
    const validation = validatePendingFingerprint(input.request, gateState)
    if (validation.kind === 'cancelled') return validation
    if (validation.kind === 'needs-reconfirmation') return { kind: 'needs-reconfirmation' }

    const candidate = buildOpenedSnapshot(
      baseline,
      validation.current,
      reason,
      input,
    )
    const committedSnapshot = durableSnapshot(candidate.snapshot)
    const publishState = publishStateFromDurable(candidate.state, committedSnapshot)
    const storage = input.storage ?? getStorage()
    if (isRevisionedStorageAdapter(storage)) {
      const envelope = await storage.loadSnapshotEnvelope()
      if (!sameCanonicalSnapshot(envelope.snapshot, baseline.snapshot)) {
        return { kind: 'needs-reconfirmation' }
      }
      try {
        await storage.commitLibraryMutation({
          expectedRevision: envelope.revision,
          snapshot: committedSnapshot,
          reason: 'risk-gate',
        })
      } catch (error) {
        if (error instanceof StorageRevisionConflictError) {
          return { kind: 'needs-reconfirmation' }
        }
        throw error
      }
    } else {
      await storage.commitImport(committedSnapshot, [])
    }
    durablyCommitted = true
    try {
      input.publish(publishState)
    } catch (error) {
      throw new RiskGatePublishAfterCommitError(
        committedSnapshot,
        error,
      )
    }
    return { kind: 'committed' }
  } finally {
    if (suspended) {
      if (durablyCommitted) discardPendingAndResumePersist()
      else resumePersist()
    }
    unlockInteraction()
  }
}
