import type { Trade } from '@/data/trades'
import {
  isTradeResultAuthorityConsistent,
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
  assert(summary.pnlCount === 2, 'conflicting PnL must be excluded from performance totals')
  assert(summary.rCount === 2, 'conflicting R must be excluded from performance totals')
  assert(summary.totalPnl === 5, 'cash totals must use verified records only')
  assert(summary.averageR === 0.5, 'average R must use verified records only')
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

export function testLegacyResultsReceiveOneStableAuthorityDuringNormalization(): void {
  const cash = normalizeTradeMetrics({ ...baseTrade, pnl: 10, rMultiple: null })
  const rOnly = normalizeTradeMetrics({ ...baseTrade, pnl: null, rMultiple: 2 })
  const importedPair = normalizeTradeMetrics({ ...baseTrade, pnl: 10, rMultiple: 2 })
  const price = normalizeTradeMetrics({
    ...baseTrade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
  })

  assert(cash.resultSource === 'pnl', 'legacy cash-only results should become cash-authoritative')
  assert(rOnly.resultSource === 'r', 'legacy R-only results should become R-authoritative')
  assert(importedPair.resultSource === 'imported', 'legacy paired metrics must remain traceable as imported')
  assert(price.resultSource === 'price', 'an explicit price authority must never be inferred away')
}

export function testLegacyImportedZeroPlaceholderRecomputesResultAuthority(): void {
  const normalized = normalizeTradeMetrics({
    ...baseTrade,
    status: 'missed',
    pnl: 0,
    rMultiple: 12.62,
    resultSource: 'imported',
  })

  assert(normalized.pnl === null, 'a missed trade placeholder cash result should become missing')
  assert(normalized.rMultiple === 12.62, 'the real R result must be preserved')
  assert(normalized.resultSource === 'r', 'normalization must recompute authority after removing a placeholder')
  assert(isTradeResultAuthorityConsistent(normalized), 'the normalized trade must remain persistable')
}

export function testDeclaredAuthorityIgnoresNonAuthoritativeMetric(): void {
  const truth = resolveTradeTruth({
    ...baseTrade,
    status: 'win',
    pnl: 10,
    rMultiple: -2,
    resultSource: 'pnl',
  })

  assert(truth.outcome === 'win', 'declared cash authority must determine the outcome')
  assert(!truth.hasConflict, 'a stale non-authoritative R must not create a result conflict')
}

export function testDeclaredAuthorityNeverFallsBackWhenItsMetricIsMissing(): void {
  const truth = resolveTradeTruth({
    ...baseTrade,
    status: 'win',
    pnl: null,
    rMultiple: 2,
    resultSource: 'pnl',
  })

  assert(truth.outcome === 'unknown', 'missing authoritative cash must remain incomplete')
  assert(!truth.isResultComplete, 'non-authoritative R must not complete a cash-authority result')
}
