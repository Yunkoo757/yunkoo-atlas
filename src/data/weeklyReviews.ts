import type { Trade } from '@/data/trades'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { isExecutedClosed, isMissed } from '@/lib/tradeStatus'
import { summarizeTradeResults } from '@/lib/tradeTruth'

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
  createdAt: string
  updatedAt: string
  completedAt: string | null
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

export function tradesClosedInWeek(trades: Trade[], weekStart: string): Trade[] {
  const weekEnd = weekEndFor(weekStart)
  return trades.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isExecutedClosed(trade.status) || !trade.closedAt) return false
    const date = trade.closedAt.slice(0, 10)
    return date >= weekStart && date <= weekEnd
  })
}

export function missedTradesInWeek(trades: Trade[], weekStart: string): Trade[] {
  const weekEnd = weekEndFor(weekStart)
  return trades.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isMissed(trade.status) || !trade.closedAt) return false
    const date = trade.closedAt.slice(0, 10)
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
    reviewedCount: trades.filter((trade) => trade.reviewStatus === 'reviewed').length,
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
    if (!current || normalized.updatedAt >= current.updatedAt) byWeek.set(normalized.weekStart, normalized)
  }
  return [...byWeek.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart))
}
