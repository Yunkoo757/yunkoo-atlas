import type {
  CaseType,
  MasteryState,
  ReviewCategory,
  ReviewStatus,
  Trade,
} from '@/data/trades'
import { normalizeTimeframe } from '@/data/trades'
import {
  selectAnalyticsCandidates,
  type AnalyticsTradeKind,
} from '@/lib/analyticsScope'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { isVerifiedTradeResult, summarizeTradeResults } from '@/lib/tradeTruth'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { buildAnalyticsMetrics, type AnalyticsMetrics } from '@/lib/analyticsMetrics'

export const DEFAULT_REVIEW_STATUS: ReviewStatus = 'unreviewed'
export const DEFAULT_REVIEW_CATEGORY: ReviewCategory = 'normal'

export const REVIEW_STATUS_META: Record<ReviewStatus, { label: string }> = {
  unreviewed: { label: '未复盘' },
  reviewed: { label: '已复盘' },
  focus: { label: '重点复盘' },
}

const REVIEW_CATEGORIES: ReviewCategory[] = [
  'normal',
  'mistake',
  'focus',
  'ambiguous',
  'recheck',
  'mastered',
]

export interface MistakeSummary {
  tag: string
  count: number
}

export interface StrategyPerformance {
  tradeCount: number
  closedCount: number
  winRate: number | null
  totalPnl: number
  totalR: number
  averageR: number | null
  worstR: number | null
  reviewedCount: number
  topMistakes: MistakeSummary[]
  metrics: AnalyticsMetrics
}

export function normalizeReviewFields(trade: Trade): Trade {
  const rawReviewStatus = trade.reviewStatus as ReviewStatus | undefined
  const reviewStatus: ReviewStatus =
    rawReviewStatus === 'reviewed' || rawReviewStatus === 'focus'
      ? rawReviewStatus
      : DEFAULT_REVIEW_STATUS
  const mistakeTags = Array.isArray(trade.mistakeTags)
    ? [...new Set(trade.mistakeTags.map((x) => x.trim()).filter(Boolean))]
    : []
  const rawCategory = trade.reviewCategory as ReviewCategory | undefined
  const reviewCategory = rawCategory && REVIEW_CATEGORIES.includes(rawCategory)
    ? rawCategory
    : inferReviewCategory({ ...trade, mistakeTags, reviewStatus })
  const caseType: CaseType | undefined = trade.tradeKind === 'case'
    ? trade.caseType ?? inferCaseType({ ...trade, mistakeTags, reviewCategory })
    : undefined
  const masteryState: MasteryState | undefined = trade.tradeKind === 'case'
    ? trade.masteryState ?? inferMasteryState({ reviewStatus, reviewCategory })
    : undefined
  let nextReviewAt = trade.nextReviewAt
  if (trade.tradeKind === 'case' && masteryState !== 'mastered' && !nextReviewAt) {
    const rawDate = trade.recordedAt ?? trade.openedAt
    const base = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? parseLocalDate(rawDate)
      : new Date(rawDate)
    if (Number.isFinite(base.getTime())) {
      base.setDate(base.getDate() + 3)
      nextReviewAt = formatYmd(base)
    }
  }
  if (masteryState === 'mastered') nextReviewAt = null

  return {
    ...trade,
    mistakeTags,
    reviewStatus,
    reviewCategory,
    timeframe: normalizeTimeframe(trade.timeframe),
    caseType,
    masteryState,
    nextReviewAt,
  }
}

function inferCaseType(
  trade: Pick<Trade, 'status' | 'mistakeTags'> & { reviewCategory: ReviewCategory },
): CaseType {
  if (trade.status === 'missed') return 'missed'
  if (trade.reviewCategory === 'ambiguous') return 'ambiguous'
  if (trade.reviewCategory === 'mistake' || trade.mistakeTags.length > 0) return 'mistake'
  return 'exemplar'
}

function inferMasteryState(
  trade: Pick<Trade, 'reviewStatus'> & { reviewCategory: ReviewCategory },
): MasteryState {
  if (trade.reviewStatus === 'reviewed' || trade.reviewCategory === 'mastered') return 'mastered'
  if (trade.reviewCategory === 'recheck') return 'recheck'
  return 'new'
}

function inferReviewCategory(
  trade: Pick<Trade, 'status' | 'mistakeTags' | 'reviewStatus'>,
): ReviewCategory {
  if (trade.reviewStatus === 'focus') return 'focus'
  if (trade.reviewStatus === 'reviewed') return 'mastered'
  if (trade.status === 'missed' || trade.mistakeTags.length > 0) return 'mistake'
  return DEFAULT_REVIEW_CATEGORY
}

export function normalizeReviewTrades(trades: Trade[]): Trade[] {
  return trades.map(normalizeReviewFields)
}

export function summarizeStrategyPerformance(
  trades: Trade[],
  strategyId: string,
  options?: { tradeKind?: AnalyticsTradeKind },
): StrategyPerformance {
  const all = selectAnalyticsCandidates(trades, {
    tradeKind: options?.tradeKind ?? 'live',
    range: 'all',
    strategyId,
  }).included
  const closed = all.filter((t) => isExecutedClosed(t.status))
  const result = summarizeTradeResults(closed)
  const rValues = closed
    .filter(isVerifiedTradeResult)
    .map((trade) => trade.rMultiple)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const totalR = rValues.reduce((sum, value) => sum + value, 0)
  const averageR = rValues.length ? totalR / rValues.length : null
  const worstR = rValues.length ? Math.min(...rValues) : null
  const reviewedCount = all.filter((t) => t.reviewStatus === 'reviewed' || t.reviewStatus === 'focus').length
  const mistakeCounts = new Map<string, number>()
  all.forEach((t) => {
    t.mistakeTags.forEach((tag) => {
      mistakeCounts.set(tag, (mistakeCounts.get(tag) ?? 0) + 1)
    })
  })
  const topMistakes = [...mistakeCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
    .slice(0, 3)

  return {
    tradeCount: all.length,
    closedCount: result.closedCount,
    winRate: result.winRate,
    totalPnl: result.totalPnl,
    totalR,
    averageR,
    worstR,
    reviewedCount,
    topMistakes,
    metrics: buildAnalyticsMetrics(all),
  }
}
