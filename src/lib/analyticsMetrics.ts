import type { Trade } from '@/data/trades'
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

function wilsonRate(wins: number, total: number): number | null {
  if (!total) return null
  const z = 1.96
  const p = wins / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)
  return (centre - spread) / denominator
}

export function buildAnalyticsMetrics(trades: Trade[]): AnalyticsMetrics {
  const closed = trades.filter((trade) => isExecutedClosed(trade.status))
  const usable = closed.filter(isUsableTradeResult)
  const pnlValues = finiteValues(usable.map((trade) => trade.pnl))
  const rValues = finiteValues(usable.map((trade) => trade.rMultiple))
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  let equity = 0
  let peak = 0
  let maxDrawdown = 0
  let losingStreak = 0
  let longestLosingStreak = 0
  for (const value of rValues) {
    equity += value
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
    losingStreak = value < 0 ? losingStreak + 1 : 0
    longestLosingStreak = Math.max(longestLosingStreak, losingStreak)
  }
  const totalR = rValues.reduce((sum, value) => sum + value, 0)
  const total = closed.length
  const resultCount = usable.length

  return {
    closedCount: total,
    resultCount,
    resultCoverage: total ? resultCount / total : 0,
    pnl: metric(pnlValues.length ? pnlValues.reduce((sum, value) => sum + value, 0) : null, pnlValues.length, total),
    r: metric(rValues.length ? totalR : null, rValues.length, total),
    averageWinR: metric(wins.length ? grossWin / wins.length : null, wins.length, resultCount),
    averageLossR: metric(losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null, losses.length, resultCount),
    expectancyR: metric(rValues.length ? totalR / rValues.length : null, rValues.length, total),
    profitFactor: metric(grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null, rValues.length, total),
    winRate: metric(wilsonRate(wins.length, rValues.length), rValues.length, total),
    maxDrawdownR: metric(rValues.length ? maxDrawdown : null, rValues.length, total),
    longestLosingStreak,
  }
}
