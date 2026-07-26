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

export interface RiskGateCommitState {
  trades: Trade[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
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

export class RiskGatePublishAfterCommitError<
  State extends RiskGateCommitState = RiskGateCommitState,
> extends Error {
  readonly code = 'risk-gate-publish-after-commit'
  readonly durablyCommitted = true
  readonly requiresStorageReload = true

  constructor(
    readonly committedState: State,
    readonly committedSnapshot: PersistedSnapshot,
    readonly cause: unknown,
  ) {
    super('风险开仓已写入存储，但内存状态发布失败；必须从 storage 重新载入')
    this.name = 'RiskGatePublishAfterCommitError'
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

function sameCanonicalSnapshot(
  left: PersistedSnapshot | null,
  right: PersistedSnapshot,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right)
}

function stateMatchesSnapshot(state: RiskGateCommitState, snapshot: PersistedSnapshot): boolean {
  return canonicalJson({
    trades: state.trades,
    riskPolicyVersions: state.riskPolicyVersions,
    monthlyRiskLimits: state.monthlyRiskLimits,
    riskOverrideEvents: state.riskOverrideEvents,
  }) === canonicalJson({
    trades: snapshot.trades,
    riskPolicyVersions: snapshot.riskPolicyVersions,
    monthlyRiskLimits: snapshot.monthlyRiskLimits,
    riskOverrideEvents: snapshot.riskOverrideEvents,
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
  if (!reason) throw new Error('风险覆盖原因不能为空')
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
    const gateState: TradeOpenRiskGateState = {
      trades: baseline.state.trades,
      riskPolicyVersions: baseline.state.riskPolicyVersions,
      monthlyRiskLimits: baseline.state.monthlyRiskLimits,
      currentTradingDayKey: baseline.currentTradingDayKey,
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
    const storage = input.storage ?? getStorage()
    if (isRevisionedStorageAdapter(storage)) {
      const envelope = await storage.loadSnapshotEnvelope()
      if (!sameCanonicalSnapshot(envelope.snapshot, baseline.snapshot)) {
        return { kind: 'needs-reconfirmation' }
      }
      try {
        await storage.commitLibraryMutation({
          expectedRevision: envelope.revision,
          snapshot: candidate.snapshot,
          reason: 'risk-gate',
        })
      } catch (error) {
        if (error instanceof StorageRevisionConflictError) {
          return { kind: 'needs-reconfirmation' }
        }
        throw error
      }
    } else {
      await storage.commitImport(candidate.snapshot, [])
    }
    durablyCommitted = true
    try {
      input.publish(candidate.state)
    } catch (error) {
      throw new RiskGatePublishAfterCommitError(
        candidate.state,
        candidate.snapshot,
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
