import type { Trade } from '@/data/trades'
import {
  normalizeTradeMetrics,
  resolveTradeTruth,
  summarizeTradeResults,
} from '@/lib/tradeTruth'

const baseTrade: Trade = {
  id: 'truth-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testClosedTradeWithoutMetricsRemainsUnevaluated(): void {
  const trade = {
    ...baseTrade,
    pnl: null,
    rMultiple: null,
  } as unknown as Trade
  const truth = resolveTradeTruth(trade)

  assert(truth.executionState === 'closed', 'closed status should resolve to closed execution')
  assert(truth.outcome === 'unknown', 'missing metrics must not inherit a win/loss label')
  assert(!truth.isResultComplete, 'missing metrics must remain pending')
  assert(!truth.hasConflict, 'missing data is incomplete, not conflicting')
}

export function testSummaryUsesOnlyVerifiedResultsAndReportsCoverage(): void {
  const missing = { ...baseTrade, id: 'missing', pnl: null, rMultiple: null } as unknown as Trade
  const conflict = { ...baseTrade, id: 'conflict', pnl: -10, rMultiple: 1 } as Trade
  const loss = { ...baseTrade, id: 'loss', status: 'loss', pnl: -5, rMultiple: -1 } as Trade
  const summary = summarizeTradeResults([baseTrade, missing, conflict, loss])

  assert(summary.closedCount === 4, 'all executed closed trades should be visible as closed')
  assert(summary.evaluatedCount === 2, 'missing and conflicting results must not enter win rate')
  assert(summary.winCount === 1 && summary.lossCount === 1, 'verified outcomes should be counted once')
  assert(summary.winRate === 50, 'win rate denominator should use verified outcomes only')
  assert(summary.pnlCount === 3, 'PnL coverage should count finite PnL values')
  assert(summary.rCount === 3, 'R coverage should count finite R values')
}

export function testLegacyPlaceholderZerosBecomeMissingWithoutErasingBreakeven(): void {
  const planned = normalizeTradeMetrics({
    ...baseTrade,
    status: 'planned',
    pnl: 0,
    rMultiple: 0,
  })
  const falseWin = normalizeTradeMetrics({ ...baseTrade, pnl: 0, rMultiple: 0 })
  const breakeven = normalizeTradeMetrics({
    ...baseTrade,
    status: 'breakeven',
    pnl: 0,
    rMultiple: 0,
  })

  assert(planned.pnl === null && planned.rMultiple === null, 'active placeholders should become missing')
  assert(falseWin.pnl === null && falseWin.rMultiple === null, 'contradictory zero win should become pending')
  assert(breakeven.pnl === 0 && breakeven.rMultiple === 0, 'explicit breakeven zeros must be preserved')
}
