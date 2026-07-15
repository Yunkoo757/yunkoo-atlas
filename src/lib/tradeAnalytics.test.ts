import type { Trade } from '@/data/trades'
import { buildTradeAnalytics } from '@/lib/tradeAnalytics'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const make = (id: string, r: number | null, closedAt = '2026-01-02'): Trade => ({
  id, ref: id, symbol: 'BTCUSDT', side: 'long', status: r == null ? 'win' : r > 0 ? 'win' : r < 0 ? 'loss' : 'breakeven',
  conviction: 'medium', strategyId: 's', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal',
  tradeKind: 'live', entry: 1, exit: 1, size: 1, pnl: r, rMultiple: r, resultSource: r == null ? undefined : 'imported',
  openedAt: '2026-01-01', closedAt, note: '',
})

export function testTradeAnalyticsKeepsNullAndZeroDistinct(): void {
  const result = buildTradeAnalytics([make('zero', 0), make('missing', null)])
  assert(result.closedCount === 2 && result.rCount === 1, 'null must not become a real zero result')
  assert(result.expectancyR.value === 0 && result.expectancyR.sampleSize === 1, 'real breakeven remains zero')
}

export function testTradeAnalyticsReturnsExplicitProfitFactorStates(): void {
  assert(buildTradeAnalytics([]).profitFactor.state === 'no-data', 'empty sample has no-data PF')
  assert(buildTradeAnalytics([make('loss', -1)]).profitFactor.state === 'no-wins', 'all-loss sample has zero PF')
  assert(buildTradeAnalytics([make('win', 1)]).profitFactor.state === 'no-losses', 'all-win sample must not serialize Infinity')
}

export function testTradeAnalyticsUsesDeterministicTemporalSequence(): void {
  const values = [make('b', -1, '2026-01-02'), make('a', 2, '2026-01-01'), make('c', -2, '')]
  const result = buildTradeAnalytics(values, values.slice(0, 2))
  assert(result.totalR.value === -1, 'all-time cross section includes undated valid results')
  assert(result.maxDrawdownR.value === 1 && result.longestLosingStreak === 1, 'sequence metrics use temporal candidates only')
}

export function testTradeAnalyticsReportsWilsonIntervalAndRollingWindows(): void {
  const trades = Array.from({ length: 25 }, (_, index) => make(String(index), index < 15 ? 1 : -1, `2026-01-${String(index + 1).padStart(2, '0')}`))
  const result = buildTradeAnalytics(trades)
  assert(result.winRate.estimate === 0.6 && result.winRate.low! < 0.6 && result.winRate.high! > 0.6, 'win rate includes 95% Wilson interval')
  assert(result.rollingExpectancy[20].sampleSize === 20, 'rolling 20 uses the latest 20 temporal results')
}

export function testWinRateAndLosingStreakDoNotRequireRValues(): void {
  const cashOnly = (id: string, pnl: number, closedAt: string): Trade => ({
    ...make(id, null, closedAt),
    status: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    pnl,
    rMultiple: null,
    resultSource: 'pnl',
  })
  const trades = [
    cashOnly('cash-win', 100, '2026-01-01'),
    cashOnly('cash-loss-1', -50, '2026-01-02'),
    cashOnly('cash-loss-2', -25, '2026-01-03'),
    make('r-win', 1, '2026-01-04'),
  ]
  const result = buildTradeAnalytics(trades)

  assert(result.rCount === 1, 'R coverage remains independent from outcome coverage')
  assert(result.temporalVerifiedCount === 4, 'temporal outcome coverage includes cash-only results')
  assert(result.winRate.sampleSize === 4 && result.winRate.estimate === 0.5, 'cash-only outcomes contribute to win rate')
  assert(result.longestLosingStreak === 2, 'cash-only losses contribute to temporal losing streaks')
}
