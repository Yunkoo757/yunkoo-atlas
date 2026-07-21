import type { Trade } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { resolveTradeTruth, summarizeTradeResults, type TradeResultSummary } from '@/lib/tradeTruth'

export interface TodayWorkflowBuckets {
  active: Trade[]
  resultPending: Trade[]
  reviewPending: Trade[]
  completedToday: Trade[]
  actionCount: number
  historicalActionCount: number
}

export type TodayClosedMetrics = TradeResultSummary

export function toLocalDateKey(value = new Date()): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

function newestFirst(left: Trade, right: Trade): number {
  const leftTime = left.closedAt ?? left.openedAt
  const rightTime = right.closedAt ?? right.openedAt
  return rightTime.localeCompare(leftTime)
}

function dateKeyFromStoredValue(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : toLocalDateKey(parsed)
}

function sameLocalDate(value: string | null | undefined, date: string): boolean {
  return dateKeyFromStoredValue(value) === date
}

function completedNewestFirst(left: Trade, right: Trade): number {
  const leftTime = left.reviewedAt ?? left.closedAt ?? left.openedAt
  const rightTime = right.reviewedAt ?? right.closedAt ?? right.openedAt
  return rightTime.localeCompare(leftTime)
}

function workflowDate(trade: Trade): string {
  return dateKeyFromStoredValue(trade.closedAt ?? trade.openedAt) ?? ''
}

/** 今日已平仓实盘（按平仓日；无 closedAt 时回退 openedAt），供战绩条统计。 */
export function filterTodayClosedLiveTrades(
  trades: readonly Trade[],
  today: string,
): Trade[] {
  return trades.filter(
    (trade) =>
      trade.tradeKind === 'live' &&
      !trade.deletedAt &&
      isExecutedClosed(trade.status) &&
      sameLocalDate(trade.closedAt ?? trade.openedAt, today),
  )
}

/** 今日战绩：仅实盘 + 今日平仓日 + summarizeTradeResults。 */
export function buildTodayClosedMetrics(
  trades: readonly Trade[],
  today: string,
): TodayClosedMetrics {
  return summarizeTradeResults(filterTodayClosedLiveTrades(trades, today))
}

/** 把交易库投影为互斥的今日行动队列，避免同一笔交易在多个区块重复出现。 */
export function getTodayWorkflowBuckets(
  trades: readonly Trade[],
  today: string,
): TodayWorkflowBuckets {
  const live = trades.filter((trade) => trade.tradeKind === 'live' && !trade.deletedAt)
  const active: Trade[] = []
  const resultPending: Trade[] = []
  const reviewPending: Trade[] = []
  const completedToday: Trade[] = []

  for (const trade of live) {
    if (trade.status === 'planned' || trade.status === 'open') {
      if (trade.status === 'planned' && workflowDate(trade) > today) continue
      active.push(trade)
      continue
    }

    const truth = resolveTradeTruth(trade)
    if (truth.executionState === 'closed' && !truth.isResultComplete) {
      resultPending.push(trade)
      continue
    }
    if (
      (truth.executionState === 'missed' ||
        (truth.executionState === 'closed' && truth.isResultComplete)) &&
      trade.reviewStatus !== 'reviewed'
    ) {
      reviewPending.push(trade)
      continue
    }
    if (
      sameLocalDate(trade.reviewedAt, today) ||
      (!trade.reviewedAt && (sameLocalDate(trade.openedAt, today) || sameLocalDate(trade.closedAt, today)))
    ) {
      completedToday.push(trade)
    }
  }

  active.sort(newestFirst)
  resultPending.sort(newestFirst)
  reviewPending.sort(newestFirst)
  completedToday.sort(completedNewestFirst)

  const actions = [...active, ...resultPending, ...reviewPending]

  return {
    active,
    resultPending,
    reviewPending,
    completedToday,
    actionCount: actions.length,
    historicalActionCount: actions.filter((trade) => workflowDate(trade) < today).length,
  }
}
