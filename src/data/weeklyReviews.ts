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
  winRate: number | null
  pnlCount: number
  totalPnl: number
  rCount: number
  averageR: number | null
  mistakeTagCounts: Record<string, number>
  missedCount: number
  missedReasonCounts: Record<string, number>
}

export interface WeeklyReview {
  id: string
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
  riskSnapshot?: WeeklyRiskReviewSnapshot
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface CompleteWeeklyReviewState {
  trades: Trade[]
  weeklyReviews: WeeklyReview[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
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

export function tradesClosedInWeek(trades: Trade[], weekStart: string, tradingDayStartHour = 0): Trade[] {
  const weekEnd = weekEndFor(weekStart)
  return trades.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isExecutedClosed(trade.status)) return false
    const date = closedTradingDayKey(trade, tradingDayStartHour)
    if (!date) return false
    return date >= weekStart && date <= weekEnd
  })
}

export function missedTradesInWeek(trades: Trade[], weekStart: string, tradingDayStartHour = 0): Trade[] {
  const weekEnd = weekEndFor(weekStart)
  return trades.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isMissed(trade.status)) return false
    const date = closedTradingDayKey(trade, tradingDayStartHour)
    if (!date) return false
    return date >= weekStart && date <= weekEnd
  })
}

export function buildWeeklyReviewMetrics(trades: Trade[], missedTrades: Trade[] = []): WeeklyReviewMetrics {
  const summary = summarizeTradeResults(trades)
  const mistakeTagCounts: Record<string, number> = {}
  const missedReasonCounts: Record<string, number> = {}
  for (const trade of trades) {
    for (const tag of trade.mistakeTags ?? []) {
      mistakeTagCounts[tag] = (mistakeTagCounts[tag] ?? 0) + 1
    }
  }
  for (const trade of missedTrades) {
    const reason = trade.missReason ?? 'other'
    missedReasonCounts[reason] = (missedReasonCounts[reason] ?? 0) + 1
  }
  return {
    tradeCount: trades.length,
    reviewedCount: trades.filter((trade) => isReviewCompleted(trade.reviewStatus)).length,
    evaluatedCount: summary.evaluatedCount,
    winCount: summary.winCount,
    lossCount: summary.lossCount,
    breakevenCount: summary.breakevenCount,
    conflictCount: summary.conflictCount,
    winRate: summary.winRate,
    pnlCount: summary.pnlCount,
    totalPnl: summary.totalPnl,
    rCount: summary.rCount,
    averageR: summary.averageR,
    mistakeTagCounts,
    missedCount: missedTrades.length,
    missedReasonCounts,
  }
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
    }).day,
    date,
  }))
  const weeklyOutcome = resolveRiskOutcomes({
    trades: riskTrades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    currentTradingDayKey: outcomeEnd,
  }).week
  const monthlyOutcomeAtCompletion = resolveRiskOutcomes({
    trades: riskTrades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    currentTradingDayKey: completionTradingDay,
  }).month
  const overrideEvents = state.riskOverrideEvents.filter((event) =>
    event.tradingDayKeyAtDecision >= review.weekStart && event.tradingDayKeyAtDecision <= review.weekEnd,
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
  const completedAt = now.toISOString()
  const review: WeeklyReview = {
    ...existing,
    status: 'completed',
    metricsSnapshot: structuredClone(buildWeeklyReviewMetrics(
      tradesClosedInWeek(state.trades, existing.weekStart, state.display.tradingDayStartHour),
      missedTradesInWeek(state.trades, existing.weekStart, state.display.tradingDayStartHour),
    )),
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
    const normalized = review.metricsSnapshot && (
      review.metricsSnapshot.missedCount === undefined ||
      review.metricsSnapshot.missedReasonCounts === undefined
    )
      ? {
          ...review,
          metricsSnapshot: {
            ...review.metricsSnapshot,
            missedCount: review.metricsSnapshot.missedCount ?? 0,
            missedReasonCounts: review.metricsSnapshot.missedReasonCounts ?? {},
          },
        }
      : review
    const current = byWeek.get(review.weekStart)
    if (!current || normalized.updatedAt > current.updatedAt) byWeek.set(normalized.weekStart, normalized)
  }
  return [...byWeek.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart))
}
