import type { Trade } from '@/data/trades'
import { computeStrategyStats } from '@/lib/strategies'
import { summarizeStrategyPerformance } from '@/lib/reviewAnalytics'
import { summarizeTradeResults } from '@/lib/tradeTruth'
import { selectDashboardAnalyticsCandidates } from '@/views/Dashboard'

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
