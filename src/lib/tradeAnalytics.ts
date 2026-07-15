import type { Trade } from '@/data/trades'
import { isUsableTradeResult, resolveTradeTruth } from '@/lib/tradeTruth'

export interface NumericMetric {
  value: number | null
  sampleSize: number
  coverage: number
}

export interface WilsonInterval {
  estimate: number | null
  low: number | null
  high: number | null
  sampleSize: number
  coverage: number
}

export type ProfitFactorMetric =
  | { state: 'no-data'; value: null; sampleSize: 0; coverage: number }
  | { state: 'no-wins'; value: 0; sampleSize: number; coverage: number }
  | { state: 'no-losses'; value: null; sampleSize: number; coverage: number }
  | { state: 'value'; value: number; sampleSize: number; coverage: number }

export interface TradeAnalytics {
  closedCount: number
  verifiedCount: number
  rCount: number
  totalR: NumericMetric
  expectancyR: NumericMetric
  medianR: NumericMetric
  averageWinR: NumericMetric
  averageLossR: NumericMetric
  winRate: WilsonInterval
  profitFactor: ProfitFactorMetric
  maxDrawdownR: NumericMetric
  currentDrawdownR: NumericMetric
  longestLosingStreak: number
  rollingExpectancy: Record<20 | 50 | 100, NumericMetric>
}

function metric(value: number | null, sampleSize: number, denominator: number): NumericMetric {
  return { value, sampleSize, coverage: denominator > 0 ? sampleSize / denominator : 0 }
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function wilson(wins: number, total: number, denominator: number): WilsonInterval {
  if (!total) return { estimate: null, low: null, high: null, sampleSize: 0, coverage: 0 }
  const z = 1.96
  const p = wins / total
  const divisor = 1 + (z * z) / total
  const centre = (p + (z * z) / (2 * total)) / divisor
  const spread = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total)) / divisor
  return {
    estimate: p,
    low: Math.max(0, centre - spread),
    high: Math.min(1, centre + spread),
    sampleSize: total,
    coverage: denominator > 0 ? total / denominator : 0,
  }
}

function closeKey(trade: Trade): string {
  const timestamp = (trade as Trade & { closedAtTimestamp?: string | null }).closedAtTimestamp
  return timestamp ?? trade.closedAt ?? ''
}

export function buildTradeAnalytics(
  included: readonly Trade[],
  temporal: readonly Trade[] = included,
): TradeAnalytics {
  const closed = included.filter((trade) => resolveTradeTruth(trade).executionState === 'closed')
  const verified = closed.filter(isUsableTradeResult)
  const rValues = verified
    .map((trade) => trade.rMultiple)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const totalRValue = rValues.reduce((sum, value) => sum + value, 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  const coverage = closed.length ? rValues.length / closed.length : 0
  const profitFactor: ProfitFactorMetric = rValues.length === 0
    ? { state: 'no-data', value: null, sampleSize: 0, coverage }
    : wins.length === 0
      ? { state: 'no-wins', value: 0, sampleSize: rValues.length, coverage }
      : losses.length === 0
        ? { state: 'no-losses', value: null, sampleSize: rValues.length, coverage }
        : { state: 'value', value: grossWin / grossLoss, sampleSize: rValues.length, coverage }

  const temporalIds = new Set(temporal.map((trade) => trade.id))
  const sequence = verified
    .filter((trade): trade is Trade & { rMultiple: number } =>
      temporalIds.has(trade.id) &&
      closeKey(trade) !== '' &&
      typeof trade.rMultiple === 'number' &&
      Number.isFinite(trade.rMultiple),
    )
    .sort((a, b) => closeKey(a).localeCompare(closeKey(b)) || a.ref.localeCompare(b.ref))
    .map((trade) => trade.rMultiple)
  let equity = 0
  let peak = 0
  let maxDrawdown = 0
  let longestLosingStreak = 0
  let losingStreak = 0
  for (const value of sequence) {
    equity += value
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
    losingStreak = value < 0 ? losingStreak + 1 : 0
    longestLosingStreak = Math.max(longestLosingStreak, losingStreak)
  }
  const rolling = (window: 20 | 50 | 100): NumericMetric => {
    const sample = sequence.slice(-window)
    return metric(sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : null, sample.length, Math.min(window, sequence.length))
  }

  return {
    closedCount: closed.length,
    verifiedCount: verified.length,
    rCount: rValues.length,
    totalR: metric(rValues.length ? totalRValue : null, rValues.length, closed.length),
    expectancyR: metric(rValues.length ? totalRValue / rValues.length : null, rValues.length, closed.length),
    medianR: metric(median(rValues), rValues.length, closed.length),
    averageWinR: metric(wins.length ? grossWin / wins.length : null, wins.length, rValues.length),
    averageLossR: metric(losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null, losses.length, rValues.length),
    winRate: wilson(wins.length, rValues.length, closed.length),
    profitFactor,
    maxDrawdownR: metric(sequence.length ? maxDrawdown : null, sequence.length, rValues.length),
    currentDrawdownR: metric(sequence.length ? peak - equity : null, sequence.length, rValues.length),
    longestLosingStreak,
    rollingExpectancy: { 20: rolling(20), 50: rolling(50), 100: rolling(100) },
  }
}
