import type { Trade } from '@/data/trades'
import { buildTradeAnalytics } from '@/lib/tradeAnalytics'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { isUsableTradeResult } from '@/lib/tradeTruth'

export interface MetricValue {
  value: number | null
  sampleSize: number
  coverage: number
}

export interface AnalyticsMetrics {
  closedCount: number
  resultCount: number
  resultCoverage: number
  pnl: MetricValue
  r: MetricValue
  averageWinR: MetricValue
  averageLossR: MetricValue
  expectancyR: MetricValue
  profitFactor: MetricValue
  winRate: MetricValue
  maxDrawdownR: MetricValue
  longestLosingStreak: number
}

const metric = (value: number | null, sampleSize: number, denominator: number): MetricValue => ({
  value,
  sampleSize,
  coverage: denominator > 0 ? sampleSize / denominator : 0,
})

function finiteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

export function buildAnalyticsMetrics(trades: Trade[]): AnalyticsMetrics {
  const closed = trades.filter((trade) => isExecutedClosed(trade.status))
  const usable = closed.filter(isUsableTradeResult)
  const pnlValues = finiteValues(usable.map((trade) => trade.pnl))
  const analytics = buildTradeAnalytics(closed)
  const profitFactorValue = analytics.profitFactor.state === 'value' || analytics.profitFactor.state === 'no-wins'
    ? analytics.profitFactor.value
    : null

  return {
    closedCount: analytics.closedCount,
    resultCount: analytics.verifiedCount,
    resultCoverage: analytics.closedCount ? analytics.verifiedCount / analytics.closedCount : 0,
    pnl: metric(
      pnlValues.length ? pnlValues.reduce((sum, value) => sum + value, 0) : null,
      pnlValues.length,
      analytics.closedCount,
    ),
    r: analytics.totalR,
    averageWinR: analytics.averageWinR,
    averageLossR: analytics.averageLossR,
    expectancyR: analytics.expectancyR,
    profitFactor: metric(
      profitFactorValue,
      analytics.profitFactor.sampleSize,
      analytics.closedCount,
    ),
    winRate: metric(
      analytics.winRate.estimate,
      analytics.winRate.sampleSize,
      analytics.closedCount,
    ),
    maxDrawdownR: analytics.maxDrawdownR,
    longestLosingStreak: analytics.longestLosingStreak,
  }
}
