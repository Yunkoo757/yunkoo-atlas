import { canonicalRiskJson, stableRiskHash } from '@/lib/riskFingerprint'
import { cloneRiskOutcome } from '@/data/riskManagement'
import type {
  MonthlyRiskLimit,
  RiskDecisionType,
  RiskPeriodOutcomeSnapshot,
  RiskPeriodScope,
  RiskPolicyVersion,
  RiskUnknownReason,
} from '@/data/riskManagement'
import { isActivityEvent, type ActivityEvent, type Trade, type TradeStatus } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { filterTradesForLiveCycle } from '@/lib/liveCycle'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/riskPolicy'

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

function hasTrustedOpenActivity(activities: Trade['activities'], currentStatus: TradeStatus): boolean {
  if (!activities?.length) return false
  const ids = new Set<string>()
  let previousTime = Number.NEGATIVE_INFINITY
  let latestStatus: ActivityEvent | null = null
  for (const activity of activities) {
    if (!isActivityEvent(activity) || ids.has(activity.id) || !isCanonicalIsoInstant(activity.timestamp)) return false
    if (activity.kind === 'status' && activity.status === undefined) return false
    if (activity.fromTradeKind === 'backtest' || activity.toTradeKind === 'backtest') return false
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
    stableSummary: stableRiskHash(canonicalRiskJson(trade)),
  }
}

export function buildRiskGateFingerprint(input: RiskGateFingerprintInput): string {
  return stableRiskHash(canonicalRiskJson({
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
      isExecutedClosed(trade.status),
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

export function reachesRiskLimit(outcome: RiskPeriodOutcomeSnapshot): boolean {
  return outcome.limitR > 0 && outcome.netBudgetR <= -outcome.limitR
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
  const knownLimitTriggered = Object.values(outcomes).some(reachesRiskLimit)
  const decisionType: RiskDecisionType | null = knownLimitTriggered
    ? 'triggered'
    : policy === null || monthlyLimit === null || resolved.gateCoverage === 'unknown'
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

export function openTradeWithActivity(trade: Trade, id: string, timestamp: string): Trade {
  return {
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
  const opened = openTradeWithActivity(trade, id, timestamp)
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
