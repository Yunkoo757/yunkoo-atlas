import type { Trade } from '@/data/trades'
import { buildAnalyticsMetrics } from '@/lib/analyticsMetrics'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const trade = (id: string, status: Trade['status'], pnl: number | null, rMultiple: number | null): Trade => ({
  id, ref: id, symbol: 'EURUSD', side: 'long', status, conviction: 'medium', strategyId: 's',
  tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', tradeKind: 'live',
  entry: 1, exit: 1, size: 1, pnl, rMultiple, openedAt: '2026-01-01', closedAt: status === 'open' ? null : '2026-01-02',
  recordedAt: '2026-01-01', timeframe: '4H', note: '', activities: [], comments: [],
})

export function testAnalyticsMetricsExposeCoverageAndMissingResults(): void {
  const result = buildAnalyticsMetrics([
    trade('1', 'win', 100, 2),
    trade('2', 'loss', -50, -1),
    trade('3', 'breakeven', null, null),
    trade('4', 'open', null, null),
  ])
  assert(result.closedCount === 3, 'only closed executions enter the denominator')
  assert(result.resultCount === 2 && result.resultCoverage === 2 / 3, 'missing results remain visible in coverage')
  assert(result.r.value === 1 && result.r.sampleSize === 2, 'R sum uses verified results only')
  assert(result.pnl.value === 50, 'P/L sum uses verified results only')
  assert(result.profitFactor.value === 2, 'profit factor uses gross positive and negative R')
  assert(result.longestLosingStreak === 1, 'losing streak is deterministic')
}

export function testAnalyticsMetricsReturnNullForEmptySamples(): void {
  const result = buildAnalyticsMetrics([])
  assert(result.expectancyR.value === null && result.winRate.value === null, 'empty metrics must be null')
  assert(result.expectancyR.coverage === 0, 'empty metrics have zero coverage')
}

export function testAnalyticsMetricsNeverSerializeInfinityAndCountCashOnlyOutcomes(): void {
  const cashWin = {
    ...trade('cash-win', 'win', 100, null),
    resultSource: 'pnl' as const,
  }
  const rWin = {
    ...trade('r-win', 'win', null, 2),
    resultSource: 'r' as const,
  }
  const result = buildAnalyticsMetrics([cashWin, rWin])

  assert(result.winRate.value === 1 && result.winRate.sampleSize === 2, 'win rate uses every usable outcome')
  assert(result.profitFactor.value === null, 'all-win R samples stay null instead of Infinity')
}
