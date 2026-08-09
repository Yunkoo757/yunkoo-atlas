import { isReviewCompleted, type Trade } from '@/data/trades'
import { createBusinessDateAnchor, getTradingDayKey } from '@/lib/periods'
import { closedTradingDayKey } from '@/lib/riskBudget'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { resolveTradeTruth, summarizeTradeResults, type TradeResultSummary } from '@/lib/tradeTruth'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import type { LiveArchiveScope } from '@/lib/liveStatisticsArchive'

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

function tradingDayKeyFromStoredValue(
  value: string | null | undefined,
  tradingDayStartHour: number,
): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : getTradingDayKey(parsed, tradingDayStartHour)
}

function completedNewestFirst(left: Trade, right: Trade): number {
  const leftTime = left.reviewedAt ?? left.closedAt ?? left.openedAt
  const rightTime = right.reviewedAt ?? right.closedAt ?? right.openedAt
  return rightTime.localeCompare(leftTime)
}

function workflowDate(trade: Trade, tradingDayStartHour: number): string {
  if (trade.status !== 'planned' && trade.status !== 'open') {
    const frozenOrClosedDay = closedTradingDayKey(trade, tradingDayStartHour)
    if (frozenOrClosedDay) return frozenOrClosedDay
  }
  return tradingDayKeyFromStoredValue(trade.openedAt, tradingDayStartHour) ?? ''
}

function todayPerformanceSelection(
  trades: readonly Trade[],
  today: string,
  tradingDayStartHour: number,
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null,
  liveScope: LiveArchiveScope | null,
) {
  const anchorNow = new Date(`${today}T12:00:00`)
  return buildPerformanceSelection(trades, {
    scope: { kind: 'live', range: 'all' },
    liveScope,
    anchor: createBusinessDateAnchor(anchorNow, tradingDayStartHour),
    legacyCashCurrencyAssumption,
    internalRange: 'today',
  })
}

/** 今日已平仓实盘只消费共享绩效选择器的可靠完整结果。 */
export function filterTodayClosedLiveTrades(
  trades: readonly Trade[],
  today: string,
  tradingDayStartHour = 0,
  liveScope: LiveArchiveScope | null = null,
): Trade[] {
  const eligible = new Set(todayPerformanceSelection(
    trades, today, tradingDayStartHour, null, liveScope,
  ).eligibleMetricIds)
  return trades.filter((trade) => eligible.has(trade.id))
}

/** 今日战绩：仅实盘 + 今日平仓日 + summarizeTradeResults。 */
export function buildTodayClosedMetrics(
  trades: readonly Trade[],
  today: string,
  tradingDayStartHour = 0,
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null = null,
  liveScope: LiveArchiveScope | null = null,
): TodayClosedMetrics {
  const selection = todayPerformanceSelection(
    trades, today, tradingDayStartHour, legacyCashCurrencyAssumption, liveScope,
  )
  const eligibleIds = new Set(selection.eligibleMetricIds)
  const pnlIds = new Set(selection.pnlIds)
  const rIds = new Set(selection.rIds)
  const closed = trades.filter((trade) => eligibleIds.has(trade.id))
  const result = summarizeTradeResults(closed)
  const pnlTrades = trades.filter((trade) => pnlIds.has(trade.id))
  const rTrades = trades.filter((trade) => rIds.has(trade.id))
  return {
    ...result,
    pnlCount: pnlTrades.length,
    totalPnl: pnlTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0),
    rCount: rTrades.length,
    averageR: rTrades.length
      ? rTrades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0) / rTrades.length
      : null,
  }
}

/** 把交易库投影为互斥的今日行动队列，避免同一笔交易在多个区块重复出现。 */
export function getTodayWorkflowBuckets(
  trades: readonly Trade[],
  today: string,
  tradingDayStartHour = 0,
): TodayWorkflowBuckets {
  const live = trades.filter((trade) => trade.tradeKind === 'live' && !trade.deletedAt)
  const active: Trade[] = []
  const resultPending: Trade[] = []
  const reviewPending: Trade[] = []
  const completedToday: Trade[] = []

  for (const trade of live) {
    if (trade.status === 'planned' || trade.status === 'open') {
      if (trade.status === 'planned' && workflowDate(trade, tradingDayStartHour) > today) continue
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
      !isReviewCompleted(trade.reviewStatus)
    ) {
      reviewPending.push(trade)
      continue
    }
    if (
      tradingDayKeyFromStoredValue(trade.reviewedAt, tradingDayStartHour) === today ||
      (!trade.reviewedAt && workflowDate(trade, tradingDayStartHour) === today)
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
    historicalActionCount: actions.filter((trade) => workflowDate(trade, tradingDayStartHour) < today).length,
  }
}
