import type {
  MonthlyRiskLimit,
  RiskDecisionType,
  RiskPeriodOutcomeSnapshot,
  RiskPeriodScope,
  RiskPolicyVersion,
  RiskUnknownReason,
} from '@/data/riskManagement'
import type { ActivityEvent, Trade, TradeStatus } from '@/data/trades'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { filterTradesForLiveCycle } from '@/lib/liveCycle'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { riskSetupStateForStage } from '@/lib/stageRisk'

const ACTIVITY_KINDS = new Set<ActivityEvent['kind']>([
  'create',
  'status',
  'strategy',
  'tag',
  'comment',
  'note',
  'tradeKind',
])
const TRADE_STATUSES = new Set<TradeStatus>([
  'planned',
  'open',
  'missed',
  'win',
  'loss',
  'breakeven',
])

export interface TradeOpenRiskGateState {
  trades: Trade[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  currentLiveStageId: string
  currentLiveStageStartsOn: string
  currentTradingDayKey: string
  tradingDayStartHour: number
}

export interface RiskGateFingerprintInput {
  trade: Trade
  liveStageId: string
  liveStageStartsOn: string
  currentTradingDayKey: string
  tradingDayStartHour: number
  policy: RiskPolicyVersion | null
  monthlyLimit: MonthlyRiskLimit | null
  outcomes: Record<RiskPeriodScope, RiskPeriodOutcomeSnapshot>
  resultRefs: readonly unknown[]
}

export interface PendingTradeOpenRequest {
  tradeId: string
  decisionType: RiskDecisionType
  currentTradingDayKey: string
  policyVersionId: string | null
  monthlyLimitId: string | null
  outcomes: Record<RiskPeriodScope, RiskPeriodOutcomeSnapshot>
  unknownReasons: RiskUnknownReason[]
  fingerprint: string
}

export type TradeOpenRequestResult =
  | 'opened'
  | 'pending-confirmation'
  | 'requires-risk-gate'
  | 'requires-risk-setup'
  | 'not-current-stage'
  | 'not-found'

export type PendingFingerprintValidation =
  | { kind: 'valid'; current: PendingTradeOpenRequest; trade: Trade }
  | { kind: 'cancelled'; reason: 'target-missing' | 'target-no-longer-eligible' }
  | { kind: 'needs-reconfirmation'; current?: PendingTradeOpenRequest }

export type TradeOpenCandidateResult<State extends TradeOpenRiskGateState = TradeOpenRiskGateState> =
  | { kind: 'not-found' }
  | { kind: 'not-current-stage'; trade: Trade }
  | { kind: 'risk-setup-required'; trade: Trade }
  | {
      kind: 'opened'
      decision: 'not-required' | 'already-open' | 'below'
      state: State
      trade: Trade
    }
  | { kind: 'confirmation-required'; request: PendingTradeOpenRequest }
  | { kind: 'pending-exists'; request: PendingTradeOpenRequest }

export interface RequestTradeOpenCandidateOptions {
  existingPending?: PendingTradeOpenRequest | null
  now?: () => string
  createActivityId?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStructurallyValidActivity(value: unknown): value is ActivityEvent {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (typeof value.kind !== 'string' || !ACTIVITY_KINDS.has(value.kind as ActivityEvent['kind'])) return false
  if (!isCanonicalIsoInstant(value.timestamp)) return false
  if (value.status !== undefined && (
    typeof value.status !== 'string' || !TRADE_STATUSES.has(value.status as TradeStatus)
  )) return false
  if (value.kind === 'status' && value.status === undefined) return false
  if (value.tagAction !== undefined && value.tagAction !== 'add' && value.tagAction !== 'remove') return false
  if (value.fromTradeKind !== undefined && !['live', 'paper', 'case'].includes(String(value.fromTradeKind))) return false
  if (value.toTradeKind !== undefined && !['live', 'paper', 'case'].includes(String(value.toTradeKind))) return false
  for (const field of ['strategyId', 'fromStrategyId', 'tag', 'commentId', 'text']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  return true
}

function hasTrustedOpenActivity(activities: Trade['activities'], currentStatus: TradeStatus): boolean {
  if (!activities?.length) return false
  const ids = new Set<string>()
  let previousTime = Number.NEGATIVE_INFINITY
  let latestStatus: ActivityEvent | null = null
  for (const activity of activities) {
    if (!isStructurallyValidActivity(activity) || ids.has(activity.id)) return false
    ids.add(activity.id)
    const timestamp = Date.parse(activity.timestamp)
    if (timestamp < previousTime) return false
    previousTime = timestamp
    if (activity.kind === 'status') latestStatus = activity
  }
  if (!latestStatus || latestStatus.status !== currentStatus) return false
  const latestStatusTime = Date.parse(latestStatus.timestamp)
  return activities.some((activity) =>
    activity.kind === 'status' &&
    activity.status === 'open' &&
    Date.parse(activity.timestamp) <= latestStatusTime
  )
}

export function requiresFirstOpenGate(trade: Trade): boolean {
  return trade.tradeKind === 'live' &&
    !trade.deletedAt &&
    trade.status !== 'open' &&
    !hasTrustedOpenActivity(trade.activities, trade.status)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

function selectTargetIdentity(trade: Trade): Record<string, unknown> {
  return {
    id: trade.id,
    ref: trade.ref,
    symbol: trade.symbol,
    status: trade.status,
    tradeKind: trade.tradeKind,
    deletedAt: trade.deletedAt ?? null,
    closedTradingDayKey: trade.closedTradingDayKey ?? null,
    hasTrustedOpenActivity: hasTrustedOpenActivity(trade.activities, trade.status),
    stableSummary: stableHash(canonicalJson(trade)),
  }
}

export function buildRiskGateFingerprint(input: RiskGateFingerprintInput): string {
  return stableHash(canonicalJson({
    target: selectTargetIdentity(input.trade),
    liveStageId: input.liveStageId,
    liveStageStartsOn: input.liveStageStartsOn,
    tradingDay: input.currentTradingDayKey,
    tradingDayStartHour: input.tradingDayStartHour,
    policyVersionId: input.policy?.id ?? null,
    monthlyLimitId: input.monthlyLimit?.id ?? null,
    outcomes: input.outcomes,
    resultRefs: input.resultRefs,
  }))
}

function riskResultRefs(
  trades: readonly Trade[],
  liveStageId: string,
  liveStageStartsOn: string,
  tradingDayStartHour: number,
): readonly unknown[] {
  return filterTradesForLiveCycle(
    trades.filter((trade) => trade.tradeKind === 'live' && trade.liveStageId === liveStageId),
    'current',
    liveStageStartsOn,
    tradingDayStartHour,
  )
    .filter((trade) =>
      trade.tradeKind === 'live' &&
      !trade.deletedAt &&
      (trade.status === 'win' || trade.status === 'loss' || trade.status === 'breakeven'),
    )
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((trade) => ({
      id: trade.id,
      status: trade.status,
      tradeKind: trade.tradeKind,
      deletedAt: trade.deletedAt ?? null,
      side: trade.side,
      entry: trade.entry,
      exit: trade.exit,
      stopLoss: trade.stopLoss ?? null,
      initialStopLoss: trade.initialStopLoss ?? null,
      size: trade.size,
      pnl: trade.pnl,
      rMultiple: trade.rMultiple,
      resultSource: trade.resultSource ?? null,
      closedAt: trade.closedAt,
      closedTradingDayKey: trade.closedTradingDayKey ?? null,
    }))
}

function cloneRiskOutcome(outcome: RiskPeriodOutcomeSnapshot): RiskPeriodOutcomeSnapshot {
  return { ...outcome, unknownReasons: [...outcome.unknownReasons] }
}

function freezePendingRequest(request: PendingTradeOpenRequest): PendingTradeOpenRequest {
  for (const outcome of Object.values(request.outcomes)) {
    Object.freeze(outcome.unknownReasons)
    Object.freeze(outcome)
  }
  Object.freeze(request.outcomes)
  Object.freeze(request.unknownReasons)
  Object.freeze(request)
  return request
}

function createPendingRequest(
  state: TradeOpenRiskGateState,
  trade: Trade,
): PendingTradeOpenRequest | null {
  const policy = activeRiskPolicy(
    state.riskPolicyVersions,
    state.currentTradingDayKey,
    state.currentLiveStageId,
  )
  const monthlyLimit = state.monthlyRiskLimits.find(
    (item) => item.liveStageId === state.currentLiveStageId &&
      item.monthKey === state.currentTradingDayKey.slice(0, 7),
  ) ?? null
  const resolved = resolveRiskOutcomes({
    trades: state.trades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    liveStageId: state.currentLiveStageId,
    liveStageStartsOn: state.currentLiveStageStartsOn,
    currentTradingDayKey: state.currentTradingDayKey,
    tradingDayStartHour: state.tradingDayStartHour,
  })
  const outcomes = {
    day: cloneRiskOutcome(resolved.day),
    week: cloneRiskOutcome(resolved.week),
    month: cloneRiskOutcome(resolved.month),
  }
  const knownLimitTriggered = Object.values(outcomes).some((outcome) =>
    outcome.limitR > 0 && outcome.netBudgetR <= -outcome.limitR)
  const decisionType: RiskDecisionType | null = knownLimitTriggered
    ? 'triggered'
    : resolved.gateCoverage === 'unknown' || (
    policy !== null && monthlyLimit === null
      )
      ? 'unknown'
      : null
  if (!decisionType) return null
  const fingerprint = buildRiskGateFingerprint({
    trade,
    liveStageId: state.currentLiveStageId,
    liveStageStartsOn: state.currentLiveStageStartsOn,
    currentTradingDayKey: state.currentTradingDayKey,
    tradingDayStartHour: state.tradingDayStartHour,
    policy,
    monthlyLimit,
    outcomes,
    resultRefs: riskResultRefs(
      state.trades,
      state.currentLiveStageId,
      state.currentLiveStageStartsOn,
      state.tradingDayStartHour,
    ),
  })
  return freezePendingRequest({
    tradeId: trade.id,
    decisionType,
    currentTradingDayKey: state.currentTradingDayKey,
    policyVersionId: policy?.id ?? null,
    monthlyLimitId: monthlyLimit?.id ?? null,
    outcomes,
    unknownReasons: [...resolved.unknownReasons],
    fingerprint,
  })
}

function openedState<State extends TradeOpenRiskGateState>(
  state: State,
  trade: Trade,
  options: RequestTradeOpenCandidateOptions,
): { state: State; trade: Trade } {
  const timestamp = options.now?.() ?? new Date().toISOString()
  if (!isCanonicalIsoInstant(timestamp)) throw new Error('open activity 时间必须是合法 ISO 时间')
  const id = options.createActivityId?.() ?? `activity-open-${trade.id}-${timestamp}`
  if (!id.trim()) throw new Error('open activity ID 不能为空')
  const opened: Trade = {
    ...trade,
    status: 'open',
    closedAt: null,
    closedTradingDayKey: undefined,
    missReason: undefined,
    activities: [...(trade.activities ?? []), {
      id,
      kind: 'status',
      status: 'open',
      timestamp,
    }],
  }
  return {
    state: {
      ...state,
      trades: state.trades.map((item) => item.id === trade.id ? opened : item),
    },
    trade: opened,
  }
}

export function requestTradeOpenCandidate<State extends TradeOpenRiskGateState>(
  state: State,
  tradeId: string,
  options: RequestTradeOpenCandidateOptions = {},
): TradeOpenCandidateResult<State> {
  const trade = state.trades.find((item) => item.id === tradeId && !item.deletedAt)
  if (!trade) return { kind: 'not-found' }
  if (trade.tradeKind !== 'live' || trade.liveStageId !== state.currentLiveStageId) {
    return { kind: 'not-current-stage', trade }
  }
  if (trade.status === 'open') return { kind: 'opened', decision: 'already-open', state, trade }
  if (riskSetupStateForStage(
    state,
    state.currentLiveStageId,
    state.currentTradingDayKey,
  ) === 'unconfigured') {
    return { kind: 'risk-setup-required', trade }
  }
  if (!requiresFirstOpenGate(trade)) {
    return { kind: 'opened', decision: 'not-required', ...openedState(state, trade, options) }
  }
  if (options.existingPending) {
    return { kind: 'pending-exists', request: options.existingPending }
  }

  const request = createPendingRequest(state, trade)
  if (request) return { kind: 'confirmation-required', request }
  return {
    kind: 'opened',
    decision: 'below',
    ...openedState(state, trade, options),
  }
}

export function validatePendingFingerprint(
  request: PendingTradeOpenRequest,
  state: TradeOpenRiskGateState,
): PendingFingerprintValidation {
  const trade = state.trades.find((item) => item.id === request.tradeId)
  if (!trade) return { kind: 'cancelled', reason: 'target-missing' }
  if (trade.tradeKind !== 'live' || trade.liveStageId !== state.currentLiveStageId) {
    return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
  }
  if (!requiresFirstOpenGate(trade)) {
    return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
  }
  const current = createPendingRequest(state, trade)
  if (!current) return { kind: 'needs-reconfirmation' }
  if (current.fingerprint !== request.fingerprint) {
    return { kind: 'needs-reconfirmation', current }
  }
  return { kind: 'valid', current, trade }
}
