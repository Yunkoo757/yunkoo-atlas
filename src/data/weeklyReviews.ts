import { isReviewCompleted, type Trade } from '@/data/trades'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
  WeeklyRiskReviewSnapshot,
} from '@/data/riskManagement'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { isExecutedClosed, isMissed } from '@/lib/tradeStatus'
import { summarizeTradeResults } from '@/lib/tradeTruth'
import { closedTradingDayKey, resolveRiskOutcomes } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import type { LivePerformanceCycleBounds } from '@/lib/livePerformanceCycles'
import type { LegacyCashCurrencyAssumption, UserProfile } from '@/storage/types'
import { buildPerformanceSelection, type PerformanceSelection } from '@/lib/performanceSelection'

export type WeeklyReviewStatus = 'draft' | 'completed'
export type WeeklyCommitmentResult = 'done' | 'partial' | 'missed' | 'not-applicable'

export const WEEKLY_MISTAKE_DIMENSIONS = [
  '追价',
  '过早入场',
  '逆势',
  '移动止损',
  '过度交易',
  '情绪化',
  '漏记计划',
] as const

export interface WeeklyReviewMetrics {
  tradeCount: number
  reviewedCount: number
  evaluatedCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  conflictCount: number
  pendingResultCount: number
  winRate: number | null
  pnlCount: number
  totalPnl: number
  rCount: number
  averageR: number | null
  mistakeTagCounts: Record<string, number>
  missedCount: number
  missedReasonCounts: Record<string, number>
}

export type WeeklyReviewEvidenceTrade = Pick<
  Trade,
  'id' | 'ref' | 'symbol' | 'status' | 'pnl' | 'rMultiple' | 'missReason' | 'cashCurrency'
>

export interface WeeklyReviewEvidenceSnapshot {
  trades: WeeklyReviewEvidenceTrade[]
  missedTrades: WeeklyReviewEvidenceTrade[]
  /** 冻结证据时使用的解释上下文；旧快照缺失表示没有可证明的假设。 */
  legacyCashCurrencyAssumption?: LegacyCashCurrencyAssumption | null
}

export interface WeeklyReview {
  id: string
  /** v12 stage ownership; undefined is accepted only while decoding v1-v11. */
  liveStageId?: string | null
  weekStart: string
  weekEnd: string
  status: WeeklyReviewStatus
  executionScore: number | null
  riskScore: number | null
  emotionScore: number | null
  strengthTags: string[]
  mistakeTags: string[]
  highlightTradeIds: string[]
  mistakeTradeIds: string[]
  followUpTradeIds: string[]
  contentHtml: string
  commitmentText: string
  commitmentCriteria: string
  previousCommitmentResult: WeeklyCommitmentResult | null
  metricsSnapshot: WeeklyReviewMetrics | null
  evidenceSnapshot?: WeeklyReviewEvidenceSnapshot
  riskSnapshot?: WeeklyRiskReviewSnapshot
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type WeeklyReviewDataSource = 'complete-snapshot' | 'live-recomputed'
export type WeeklyReviewSnapshotCategory = 'metrics' | 'evidence' | 'risk'

export function missingWeeklyReviewSnapshotCategories(review: WeeklyReview): WeeklyReviewSnapshotCategory[] {
  return [
    review.metricsSnapshot ? null : 'metrics',
    review.evidenceSnapshot ? null : 'evidence',
    review.riskSnapshot ? null : 'risk',
  ].filter((category): category is WeeklyReviewSnapshotCategory => category !== null)
}

export function resolveWeeklyReviewDataSource(review: WeeklyReview): WeeklyReviewDataSource {
  return missingWeeklyReviewSnapshotCategories(review).length === 0
    ? 'complete-snapshot'
    : 'live-recomputed'
}

export interface CompleteWeeklyReviewState {
  trades: Trade[]
  weeklyReviews: WeeklyReview[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  liveStatsStartTradingDayKey: string | null
  profile: Pick<UserProfile, 'legacyCashCurrencyAssumption'>
  display: { tradingDayStartHour: number }
}

export interface CompleteWeeklyReviewCandidate {
  review: WeeklyReview
  weeklyReviews: WeeklyReview[]
}

export interface WeeklyReviewTrendPoint {
  week: string
  score: number
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function weekStartFor(date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const distance = (local.getDay() + 6) % 7
  return formatYmd(addDays(local, -distance))
}

export function weekEndFor(weekStart: string): string {
  return formatYmd(addDays(parseLocalDate(weekStart), 6))
}

export function createWeeklyReview(weekStart: string, now = new Date()): WeeklyReview {
  const timestamp = now.toISOString()
  return {
    id: `weekly-review:${weekStart}`,
    weekStart,
    weekEnd: weekEndFor(weekStart),
    status: 'draft',
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: '',
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  }
}

/** Store 写入边界使用：新周复盘归当前阶段，已有复盘的归属（包括 null）保持不变。 */
export function assignWeeklyReviewStage(
  review: WeeklyReview,
  currentLiveStageId: string,
  existing?: WeeklyReview,
): WeeklyReview {
  return existing
    ? { ...review, liveStageId: existing.liveStageId }
    : { ...review, liveStageId: currentLiveStageId }
}

export function tradesClosedInWeek(
  trades: Trade[],
  weekStart: string,
  tradingDayStartHour = 0,
  currentTradingDayKey = weekEndFor(weekStart),
): Trade[] {
  return buildWeeklyReviewTradeSelection(
    trades,
    weekStart,
    tradingDayStartHour,
    currentTradingDayKey,
    null,
  ).trades
}

export type WeeklyReviewTradeSelection = Pick<
  PerformanceSelection,
  'eligibleMetricIds' | 'pnlIds' | 'rIds' | 'conflictResultIds' | 'missingResultIds'
> & { trades: Trade[] }

export function buildWeeklyReviewTradeSelection(
  trades: Trade[],
  weekStart: string,
  tradingDayStartHour = 0,
  currentTradingDayKey = weekEndFor(weekStart),
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null = null,
): WeeklyReviewTradeSelection {
  const weekEnd = weekEndFor(weekStart)
  const selection = buildPerformanceSelection(trades, {
    scope: { kind: 'live', range: 'all' },
    liveScope: null,
    anchor: {
      now: parseLocalDate(currentTradingDayKey),
      tradingDayStartHour,
      currentTradingDayKey,
    },
    legacyCashCurrencyAssumption,
  })
  const evidenceIds = new Set([
    ...selection.eligibleMetricIds,
    ...selection.conflictResultIds,
    ...selection.missingResultIds,
  ])
  const evidenceTrades = trades.filter((trade) => {
    if (!evidenceIds.has(trade.id)) return false
    const date = closedTradingDayKey(trade, tradingDayStartHour)
    return date !== null && date >= weekStart && date <= weekEnd
  })
  const idsInWeek = new Set(evidenceTrades.map((trade) => trade.id))
  const withinWeek = (ids: readonly string[]) => ids.filter((id) => idsInWeek.has(id))
  return {
    trades: evidenceTrades,
    eligibleMetricIds: withinWeek(selection.eligibleMetricIds),
    pnlIds: withinWeek(selection.pnlIds),
    rIds: withinWeek(selection.rIds),
    conflictResultIds: withinWeek(selection.conflictResultIds),
    missingResultIds: withinWeek(selection.missingResultIds),
  }
}

export function missedTradesInWeek(
  trades: Trade[],
  weekStart: string,
  tradingDayStartHour = 0,
  performanceBounds: LivePerformanceCycleBounds | null = null,
  currentTradingDayKey = weekEndFor(weekStart),
): Trade[] {
  const weekEnd = weekEndFor(weekStart)
  return trades.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isMissed(trade.status)) return false
    const date = closedTradingDayKey(trade, tradingDayStartHour)
    if (!date) return false
    if (date > currentTradingDayKey) return false
    if (
      performanceBounds !== null &&
      (performanceBounds.startInclusive !== null && date < performanceBounds.startInclusive ||
        performanceBounds.endExclusive !== null && date >= performanceBounds.endExclusive)
    ) return false
    return date >= weekStart && date <= weekEnd
  })
}

function reviewActivityWeek(
  trade: Trade,
  tradingDayStartHour: number,
  evidenceIds: ReadonlySet<string>,
  currentTradingDayKey: string,
): string | null {
  if (trade.deletedAt || trade.tradeKind !== 'live') return null
  if (!isExecutedClosed(trade.status) && !isMissed(trade.status)) return null
  if (isExecutedClosed(trade.status) && !evidenceIds.has(trade.id)) return null
  const day = closedTradingDayKey(trade, tradingDayStartHour)
  if (day !== null && day > currentTradingDayKey) return null
  return day ? weekStartFor(parseLocalDate(day)) : null
}

export function deriveWeeklyReviewWeeks(
  trades: Trade[],
  reviews: Pick<WeeklyReview, 'weekStart'>[],
  currentWeek: string,
  tradingDayStartHour = 0,
  activityLimit = 12,
  currentTradingDayKey = weekEndFor(currentWeek),
): string[] {
  const limit = Math.max(0, Math.trunc(activityLimit))
  const selection = buildPerformanceSelection(trades, {
    scope: { kind: 'live', range: 'all' },
    liveScope: null,
    anchor: {
      now: parseLocalDate(currentTradingDayKey),
      tradingDayStartHour,
      currentTradingDayKey,
    },
    legacyCashCurrencyAssumption: null,
  })
  const evidenceIds = new Set([
    ...selection.eligibleMetricIds,
    ...selection.conflictResultIds,
    ...selection.missingResultIds,
  ])
  const activityWeeks = [...new Set(trades.flatMap((trade) => {
    const week = reviewActivityWeek(
      trade, tradingDayStartHour, evidenceIds, currentTradingDayKey,
    )
    return week ? [week] : []
  }))]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, limit)
  return [...new Set([
    currentWeek,
    ...reviews.map((review) => review.weekStart),
    ...activityWeeks,
  ])].sort((left, right) => right.localeCompare(left))
}

export function buildWeeklyReviewMetrics(
  trades: Trade[],
  missedTrades: Trade[] = [],
  eligibleUsdPnlIds?: readonly string[],
  metricSelection?: Pick<
    WeeklyReviewTradeSelection,
    'eligibleMetricIds' | 'rIds' | 'conflictResultIds' | 'missingResultIds'
  >,
): WeeklyReviewMetrics {
  const eligibleMetricIdSet = metricSelection === undefined
    ? null
    : new Set(metricSelection.eligibleMetricIds)
  const performanceTrades = eligibleMetricIdSet === null
    ? trades
    : trades.filter((trade) => eligibleMetricIdSet.has(trade.id))
  const summary = summarizeTradeResults(performanceTrades)
  const eligibleRIdSet = metricSelection === undefined ? null : new Set(metricSelection.rIds)
  const rValues = performanceTrades.flatMap((trade) =>
    (eligibleRIdSet === null || eligibleRIdSet.has(trade.id)) &&
      typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple)
      ? [trade.rMultiple]
      : [],
  )
  const eligibleUsdPnlIdSet = eligibleUsdPnlIds === undefined ? null : new Set(eligibleUsdPnlIds)
  const usdPnlTrades = performanceTrades.filter((trade) =>
    typeof trade.pnl === 'number' && Number.isFinite(trade.pnl) &&
    (eligibleUsdPnlIdSet === null || eligibleUsdPnlIdSet.has(trade.id)),
  )
  const mistakeTagCounts: Record<string, number> = {}
  const missedReasonCounts: Record<string, number> = {}
  for (const trade of performanceTrades) {
    for (const tag of trade.mistakeTags ?? []) {
      mistakeTagCounts[tag] = (mistakeTagCounts[tag] ?? 0) + 1
    }
  }
  for (const trade of missedTrades) {
    const reason = trade.missReason ?? 'other'
    missedReasonCounts[reason] = (missedReasonCounts[reason] ?? 0) + 1
  }
  return {
    tradeCount: performanceTrades.length,
    reviewedCount: performanceTrades.filter((trade) => isReviewCompleted(trade.reviewStatus)).length,
    evaluatedCount: summary.evaluatedCount,
    winCount: summary.winCount,
    lossCount: summary.lossCount,
    breakevenCount: summary.breakevenCount,
    conflictCount: metricSelection?.conflictResultIds.length ?? summary.conflictCount,
    pendingResultCount: metricSelection?.missingResultIds.length ?? 0,
    winRate: summary.winRate,
    pnlCount: usdPnlTrades.length,
    totalPnl: usdPnlTrades.reduce((total, trade) => total + (trade.pnl ?? 0), 0),
    rCount: metricSelection === undefined ? summary.rCount : rValues.length,
    averageR: metricSelection === undefined
      ? summary.averageR
      : rValues.length === 0
        ? null
        : rValues.reduce((total, value) => total + value, 0) / rValues.length,
    mistakeTagCounts,
    missedCount: missedTrades.length,
    missedReasonCounts,
  }
}

function toWeeklyReviewEvidenceTrade(trade: WeeklyReviewEvidenceTrade): WeeklyReviewEvidenceTrade {
  const evidence: WeeklyReviewEvidenceTrade = {
    id: trade.id,
    ref: trade.ref,
    symbol: trade.symbol,
    status: trade.status,
    pnl: trade.pnl,
    rMultiple: trade.rMultiple,
    ...(trade.missReason ? { missReason: trade.missReason } : {}),
  }
  if (Object.prototype.hasOwnProperty.call(trade, 'cashCurrency')) {
    evidence.cashCurrency = trade.cashCurrency
  }
  return evidence
}

function daysThrough(start: string, end: string): string[] {
  const days: string[] = []
  for (let day = start; day <= end; day = formatYmd(addDays(parseLocalDate(day), 1))) days.push(day)
  return days
}

function buildWeeklyRiskReviewSnapshot(
  state: CompleteWeeklyReviewState,
  review: WeeklyReview,
  frozenAt: string,
): WeeklyRiskReviewSnapshot {
  const completionTradingDay = getTradingDayKey(new Date(frozenAt), state.display.tradingDayStartHour)
  const outcomeEnd = completionTradingDay < review.weekEnd ? completionTradingDay : review.weekEnd
  const reviewDays = daysThrough(review.weekStart, outcomeEnd)
  const riskTrades = state.trades.map((trade) => {
    if (trade.closedTradingDayKey !== undefined) return trade
    const dayKey = closedTradingDayKey(trade, state.display.tradingDayStartHour)
    return dayKey ? { ...trade, closedTradingDayKey: dayKey } : trade
  })
  const policyVersions = [...new Map(reviewDays.flatMap((date) => {
    const policy = activeRiskPolicy(state.riskPolicyVersions, date)
    return policy ? [[policy.id, policy] as const] : []
  })).values()]
  const dailyOutcomes = reviewDays.map((date) => ({
    ...resolveRiskOutcomes({
      trades: riskTrades.filter((trade) => {
        const closedDay = closedTradingDayKey(trade, state.display.tradingDayStartHour)
        return closedDay === null || closedDay <= date || closedDay > completionTradingDay
      }),
      policies: state.riskPolicyVersions,
      monthlyLimits: state.monthlyRiskLimits,
      currentTradingDayKey: date,
      liveStatsStartTradingDayKey: state.liveStatsStartTradingDayKey,
      tradingDayStartHour: state.display.tradingDayStartHour,
    }).day,
    date,
  }))
  const weeklyOutcome = resolveRiskOutcomes({
    trades: riskTrades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    currentTradingDayKey: outcomeEnd,
    liveStatsStartTradingDayKey: state.liveStatsStartTradingDayKey,
    tradingDayStartHour: state.display.tradingDayStartHour,
  }).week
  const monthlyOutcomeAtCompletion = resolveRiskOutcomes({
    trades: riskTrades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    currentTradingDayKey: completionTradingDay,
    liveStatsStartTradingDayKey: state.liveStatsStartTradingDayKey,
    tradingDayStartHour: state.display.tradingDayStartHour,
  }).month
  const overrideEvents = state.riskOverrideEvents.filter((event) =>
    event.tradingDayKeyAtDecision >= review.weekStart && event.tradingDayKeyAtDecision <= review.weekEnd &&
    (!state.liveStatsStartTradingDayKey || event.tradingDayKeyAtDecision >= state.liveStatsStartTradingDayKey),
  )
  return structuredClone({
    policyVersions,
    dailyOutcomes,
    weeklyOutcome,
    monthlyOutcomeAtCompletion,
    overrideEvents,
    frozenAt,
  })
}

export function completeWeeklyReviewCandidate(
  state: CompleteWeeklyReviewState,
  reviewId: string,
  now = new Date(),
): CompleteWeeklyReviewCandidate {
  const existing = state.weeklyReviews.find((review) => review.id === reviewId)
  if (!existing) throw new Error(`找不到周复盘：${reviewId}`)
  if (existing.status === 'completed') {
    return {
      review: existing,
      weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews),
    }
  }
  const completedAt = now.toISOString()
  const completionTradingDay = getTradingDayKey(now, state.display.tradingDayStartHour)
  const tradeSelection = buildWeeklyReviewTradeSelection(
    state.trades,
    existing.weekStart,
    state.display.tradingDayStartHour,
    completionTradingDay,
    state.profile.legacyCashCurrencyAssumption,
  )
  const missedTrades = missedTradesInWeek(
    state.trades,
    existing.weekStart,
    state.display.tradingDayStartHour,
    null,
    completionTradingDay,
  )
  const review: WeeklyReview = {
    ...existing,
    status: 'completed',
    metricsSnapshot: structuredClone(buildWeeklyReviewMetrics(
      tradeSelection.trades,
      missedTrades,
      tradeSelection.pnlIds,
      tradeSelection,
    )),
    evidenceSnapshot: {
      trades: tradeSelection.trades.map(toWeeklyReviewEvidenceTrade),
      missedTrades: missedTrades.map(toWeeklyReviewEvidenceTrade),
      legacyCashCurrencyAssumption: state.profile.legacyCashCurrencyAssumption
        ? { ...state.profile.legacyCashCurrencyAssumption }
        : null,
    },
    riskSnapshot: buildWeeklyRiskReviewSnapshot(state, existing, completedAt),
    completedAt,
    updatedAt: completedAt,
  }
  return {
    review,
    weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews.map((item) => item.id === reviewId ? review : item)),
  }
}

export function reopenCompletedReview(review: WeeklyReview, now = new Date()): WeeklyReview {
  return {
    ...review,
    status: 'draft',
    metricsSnapshot: null,
    evidenceSnapshot: undefined,
    riskSnapshot: undefined,
    completedAt: null,
    updatedAt: now.toISOString(),
  }
}

export function summarizeWeeklyMistakeDimensions(reviews: WeeklyReview[]): Record<string, number> {
  const dimensions = new Set<string>(WEEKLY_MISTAKE_DIMENSIONS)
  const counts: Record<string, number> = {}
  for (const review of reviews) {
    for (const tag of review.mistakeTags) {
      if (dimensions.has(tag)) counts[tag] = (counts[tag] ?? 0) + 1
    }
  }
  return counts
}

export function weeklyReviewScoreAverage(review: WeeklyReview): number | null {
  const scores = [review.executionScore, review.riskScore, review.emotionScore]
  return scores.every((score) => score !== null)
    ? scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) / scores.length
    : null
}

export function buildWeeklyReviewTrend(reviews: WeeklyReview[]): WeeklyReviewTrendPoint[] {
  return reviews.flatMap((review) => {
    if (review.status !== 'completed') return []
    const score = weeklyReviewScoreAverage(review)
    if (score === null) return []
    return [{ week: review.weekStart.slice(5), score: Number(score.toFixed(1)) }]
  })
}

export function normalizeWeeklyReviews(value: WeeklyReview[] | undefined): WeeklyReview[] {
  if (!value) return []
  const byWeek = new Map<string, WeeklyReview>()
  for (const review of value) {
    let normalized: WeeklyReview = review.metricsSnapshot && (
      review.metricsSnapshot.pendingResultCount === undefined ||
      review.metricsSnapshot.missedCount === undefined ||
      review.metricsSnapshot.missedReasonCounts === undefined
    )
      ? {
          ...review,
          metricsSnapshot: {
            ...review.metricsSnapshot,
            pendingResultCount: review.metricsSnapshot.pendingResultCount ?? 0,
            missedCount: review.metricsSnapshot.missedCount ?? 0,
            missedReasonCounts: review.metricsSnapshot.missedReasonCounts ?? {},
          },
        }
      : review
    if (normalized.evidenceSnapshot) {
      normalized = {
        ...normalized,
        evidenceSnapshot: {
          trades: normalized.evidenceSnapshot.trades.map(toWeeklyReviewEvidenceTrade),
          missedTrades: normalized.evidenceSnapshot.missedTrades.map(toWeeklyReviewEvidenceTrade),
          ...(Object.prototype.hasOwnProperty.call(
            normalized.evidenceSnapshot,
            'legacyCashCurrencyAssumption',
          ) ? {
              legacyCashCurrencyAssumption: normalized.evidenceSnapshot.legacyCashCurrencyAssumption
                ? { ...normalized.evidenceSnapshot.legacyCashCurrencyAssumption }
                : null,
            } : {}),
        },
      }
    }
    const current = byWeek.get(review.weekStart)
    if (!current || normalized.updatedAt > current.updatedAt) byWeek.set(normalized.weekStart, normalized)
  }
  return [...byWeek.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart))
}
