import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { computeStrategyStats } from '@/lib/strategies'
import { summarizeStrategyPerformance } from '@/lib/reviewAnalytics'
import { summarizeTradeResults } from '@/lib/tradeTruth'
import { buildDashboardStats, selectDashboardAnalyticsCandidates } from '@/views/Dashboard'

const base: Trade = {
  id: 'live',
  ref: 'TRD-live',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'live',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function fixture(id: string, overrides: Partial<Trade> = {}): Trade {
  return { ...base, ...overrides, id, ref: `TRD-${id}` }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testDashboardAndStrategyEntrypointsShareTheDefaultLiveScope(): void {
  const trades = [
    fixture('live'),
    fixture('paper', { tradeKind: 'paper', status: 'loss', pnl: -20, rMultiple: -1 }),
    fixture('case', { tradeKind: 'case' }),
    fixture('open', { status: 'open', closedAt: null, pnl: null, rMultiple: null }),
    fixture('deleted', { deletedAt: '2026-07-03T00:00:00.000Z' }),
  ]

  const dashboardCandidates = selectDashboardAnalyticsCandidates(trades, 'live', 'all')
  const dashboardSummary = summarizeTradeResults(dashboardCandidates.included)
  const reviewSummary = summarizeStrategyPerformance(trades, 'breakout')
  const settingsSummary = computeStrategyStats(trades, 'breakout')

  for (const summary of [reviewSummary, settingsSummary]) {
    assert(summary.closedCount === dashboardSummary.closedCount, 'closed count must match Dashboard')
    assert(summary.winRate === dashboardSummary.winRate, 'win rate must match Dashboard')
    assert(summary.totalPnl === dashboardSummary.totalPnl, 'PnL must match Dashboard')
    assert(summary.averageR === dashboardSummary.averageR, 'average R must match Dashboard')
  }
  assert(
    dashboardCandidates.included.map((trade) => trade.id).join(',') === 'live',
    'all three analytics entrypoints must use the closed live candidate set by default',
  )
  assert(reviewSummary.metrics.resultCount === 1, 'strategy metrics must use the same verified result scope')
}

export function testDashboardNeverBuildsCrossCurrencyMoneyCurvesAndKeepsStrategyOrder(): void {
  const strategies: Strategy[] = [
    { id: 'pullback', name: '回调', icon: 'arrow-left-right', color: '#27ae60' },
    { id: 'breakout', name: '突破', icon: 'trending-up', color: '#5e6ad2' },
  ]
  const usd = fixture('usd', {
    strategyId: 'breakout',
    pnl: 10,
    rMultiple: 2,
    pnlCurrency: 'USD',
    pnlCurrencySource: 'manual',
    pnlBasis: 'net',
  })
  const eur = fixture('eur', {
    strategyId: 'pullback',
    closedAt: '2026-07-03',
    pnl: 20,
    rMultiple: 1,
    pnlCurrency: 'EUR',
    pnlCurrencySource: 'manual',
    pnlBasis: 'net',
  })
  const stats = buildDashboardStats([usd, eur], [usd, eur], strategies)

  assert(stats.money.state === 'mixed-currency', 'mixed currencies remain explicit')
  assert(stats.curves.money.length === 0, 'mixed currencies must never produce an additive money curve')
  assert(stats.curves.r.at(-1)?.value === 3, 'currency-independent cumulative R remains available')
  assert(stats.strategies.map((strategy) => strategy.id).join(',') === 'pullback,breakout', 'strategy rows keep configured order')
}

export function testDashboardRollingTwentyRequiresACompleteWindow(): void {
  const trades = Array.from({ length: 20 }, (_, index) => fixture(`r-${index}`, {
    closedAt: `2026-07-${String(index + 1).padStart(2, '0')}`,
    status: index === 19 ? 'loss' : 'win',
    rMultiple: index === 19 ? -1 : 1,
    pnl: null,
    resultSource: 'r',
  }))
  const stats = buildDashboardStats(trades, trades, [])

  assert(stats.curves.rolling20.length === 1, 'rolling 20 does not publish partial windows')
  assert(stats.curves.rolling20[0]?.value === 0.9, 'rolling 20 uses exactly the latest twenty R values')
}
