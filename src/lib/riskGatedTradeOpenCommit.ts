import type { PersistencePause } from '@/storage/persistenceController'
import { canonicalJsonEqual } from '@/lib/riskFingerprint'
import { plainDataEqual } from '@/lib/plainData'
import { cloneRiskOutcome, normalizeRiskOverrideReason } from '@/data/riskManagement'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
} from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import {
  openTradeWithActivity,
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
import { storageDocumentSignal, suspendPersist } from '@/storage/persist'
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
  publish: (state: State) => PersistedSnapshot | void
  isCurrentSession?: () => boolean
  storage?: StorageAdapter
  now?: () => string
  createActivityId?: () => string
  createEventId?: () => string
}

export type RiskGatedTradeOpenCommitResult =
  | { kind: 'committed'; trailingSaveFailed?: true }
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

/** 已写盘的开仓活动先于等待期间的后续状态修改。保留最新笔记、字段和活动。 */
function reconcileOpenedTrade(current: Trade, source: Trade, opened: Trade): Trade {
  if (current === source) return opened
  if (current.tradeKind !== 'live' || source.tradeKind !== 'live' || current.liveStageId !== source.liveStageId) {
    throw new Error('风险确认写入期间目标记录的归属已变更')
  }
  const opening = opened.activities!.at(-1)!
  const activities = [...(current.activities ?? [])]
  const existing = activities.find(item => item.id === opening.id)
  if (existing && !plainDataEqual(existing, opening)) throw new Error('开仓活动 ID 与并发编辑冲突')
  const oldIds = new Set(source.activities?.map(item => item.id))
  const firstNew = activities.findIndex(item => !oldIds.has(item.id))
  const laterStatus = activities.some(item => !oldIds.has(item.id) && item.id !== opening.id && item.kind === 'status')
  if (!existing) activities.splice(firstNew < 0 ? activities.length : firstNew, 0, opening)
  const statusChanged = laterStatus || current.status !== source.status || current.closedAt !== source.closedAt ||
    current.closedTradingDayKey !== source.closedTradingDayKey || current.missReason !== source.missReason
  if (statusChanged) return { ...current, activities }
  return {
    ...current,
    status: opened.status,
    closedAt: opened.closedAt,
    closedTradingDayKey: opened.closedTradingDayKey,
    missReason: opened.missReason,
    activities,
  }
}

const RISK_CAPTURE_KEYS = [
  'trades', 'currentLiveStageId', 'riskPolicyVersions', 'monthlyRiskLimits', 'riskOverrideEvents',
] as const

function stateMatchesSnapshot(state: RiskGateCommitState, snapshot: PersistedSnapshot): boolean {
  return canonicalJsonEqual(state.display.tradingDayStartHour, snapshot.display.tradingDayStartHour) &&
    RISK_CAPTURE_KEYS.every(key => canonicalJsonEqual(state[key], snapshot[key]))
}

function validateOpenCapture<State extends RiskGateCommitState>(
  request: PendingTradeOpenRequest,
  baseline: ReturnType<CommitRiskGatedTradeOpenInput<State>['captureLatestState']>,
) {
  if (!stateMatchesSnapshot(baseline.state, baseline.snapshot)) {
    return { kind: 'needs-reconfirmation' } as const
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
  return validatePendingFingerprint(request, gateState)
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
): { source: Trade; opened: Trade; event: RiskOverrideEvent; snapshot: PersistedSnapshot } {
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

  const opened = openTradeWithActivity(trade, activityId, timestamp)
  const event: RiskOverrideEvent = {
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
  }
  const trades = baseline.state.trades.map((item) => item.id === trade.id ? opened : item)
  const snapshotRiskOverrideEvents = [...baseline.snapshot.riskOverrideEvents, event]
  return {
    source: trade, opened, event,
    snapshot: { ...baseline.snapshot, trades, riskOverrideEvents: snapshotRiskOverrideEvents },
  }
}

function publishCommittedOpen<State extends RiskGateCommitState>(
  input: CommitRiskGatedTradeOpenInput<State>,
  baseline: PersistedSnapshot,
  candidate: ReturnType<typeof buildOpenedSnapshot>,
  committedSnapshot: PersistedSnapshot,
): boolean {
  const latest = input.captureLatestState()
  const { event, source, opened } = candidate
  const existing = latest.state.riskOverrideEvents.find(item => item.id === event.id)
  if (existing && !plainDataEqual(existing, event)) throw new Error('风险审计 ID 与并发编辑冲突')
  const trades = latest.state.trades.map(trade => trade.id === source.id ? reconcileOpenedTrade(trade, source, opened) : trade)
  const events = existing ? latest.state.riskOverrideEvents : [...latest.state.riskOverrideEvents, event]
  const published = input.publish({
    ...latest.state,
    trades: clonePlainData(trades),
    riskOverrideEvents: clonePlainData(events),
    riskPolicyVersions: clonePlainData(latest.state.riskPolicyVersions),
    monthlyRiskLimits: clonePlainData(latest.state.monthlyRiskLimits),
  })
  // Store 订阅者也可能在发布时编辑。只有实际状态与已提交快照一致才可丢弃待写项。
  return published
    ? !plainDataEqual(published, committedSnapshot)
    : !plainDataEqual(latest.snapshot, baseline)
}

export async function commitRiskGatedTradeOpen<State extends RiskGateCommitState>(
  input: CommitRiskGatedTradeOpenInput<State>,
): Promise<RiskGatedTradeOpenCommitResult> {
  const reason = normalizeRiskOverrideReason(input.reason)
  const isCurrent = () => !storageDocumentSignal.aborted && input.isCurrentSession?.() !== false
  if (!isCurrent()) return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
  const unlockInteraction = lockStorageCutoverInteraction(storageDocumentSignal)
  let pause: PersistencePause | undefined
  let durablyCommitted = false
  try {
    await flushStorageBeforeCutover()
    pause = suspendPersist()
    if (!isCurrent()) return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
    const baseline = input.captureLatestState()
    const validation = validateOpenCapture(input.request, baseline)
    if (validation.kind === 'cancelled') return validation
    if (validation.kind === 'needs-reconfirmation') return { kind: 'needs-reconfirmation' }

    const candidate = buildOpenedSnapshot(
      baseline,
      validation.current,
      reason,
      input,
    )
    const committedSnapshot = durableSnapshot(candidate.snapshot)
    const storage = input.storage ?? getStorage()
    if (isRevisionedStorageAdapter(storage)) {
      const envelope = await storage.loadSnapshotEnvelope()
      if (!isCurrent()) return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
      if (!canonicalJsonEqual(envelope.snapshot, baseline.snapshot)) {
        return { kind: 'needs-reconfirmation' }
      }
      const current = input.captureLatestState()
      if (current.state !== baseline.state || current.currentTradingDayKey !== baseline.currentTradingDayKey) {
        const rechecked = validateOpenCapture(input.request, current)
        if (rechecked.kind !== 'valid') return rechecked
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
    if (!isCurrent()) {
      return { kind: 'committed' }
    }

    let saveConcurrentEdits: boolean
    try {
      saveConcurrentEdits = publishCommittedOpen(input, baseline.snapshot, candidate, committedSnapshot)
    } catch (error) {
      throw new RiskGatePublishAfterCommitError(
        committedSnapshot,
        error,
      )
    }
    if (saveConcurrentEdits) {
      const ownedPause = pause
      pause = undefined
      try {
        await ownedPause.resumeAndFlush()
      } catch {
        // 开仓与审计已经落盘。自动保存保留失败快照及错误，重试只保存后续编辑。
        return { kind: 'committed', trailingSaveFailed: true }
      }
    }
    return { kind: 'committed' }
  } finally {
    try {
      if (pause) {
        if (!isCurrent()) pause.resume({ flushNow: false })
        else if (durablyCommitted) pause.discardAndResume()
        else pause.resume()
      }
    } finally {
      unlockInteraction()
    }
  }
}
