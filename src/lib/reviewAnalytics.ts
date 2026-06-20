import type { ReviewStatus, Trade, TradeKind } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'

export const DEFAULT_REVIEW_STATUS: ReviewStatus = 'unreviewed'

export const REVIEW_STATUS_META: Record<ReviewStatus, { label: string }> = {
  unreviewed: { label: '未复盘' },
  reviewed: { label: '已复盘' },
  focus: { label: '重点复盘' },
}

export interface MistakeSummary {
  tag: string
  count: number
}

export interface StrategyPerformance {
  tradeCount: number
  closedCount: number
  winRate: number
  totalR: number
  averageR: number
  worstR: number | null
  reviewedCount: number
  topMistakes: MistakeSummary[]
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
  return {
    ...trade,
    mistakeTags,
    reviewStatus,
  }
}

export function normalizeReviewTrades(trades: Trade[]): Trade[] {
  return trades.map(normalizeReviewFields)
}

export function summarizeStrategyPerformance(
  trades: Trade[],
  strategyId: string,
  options?: { tradeKind?: TradeKind | 'all' },
): StrategyPerformance {
  const kind = options?.tradeKind ?? 'all'
  const all = trades.filter(
    (t) => t.strategyId === strategyId && (kind === 'all' || t.tradeKind === kind),
  )
  const closed = all.filter((t) => isExecutedClosed(t.status))
  const wins = closed.filter((t) => t.rMultiple > 0 || t.pnl > 0)
  const totalR = closed.reduce((sum, t) => sum + t.rMultiple, 0)
  const averageR = closed.length ? totalR / closed.length : 0
  const worstR = closed.length ? Math.min(...closed.map((t) => t.rMultiple)) : null
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
    closedCount: closed.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalR,
    averageR,
    worstR,
    reviewedCount,
    topMistakes,
  }
}

