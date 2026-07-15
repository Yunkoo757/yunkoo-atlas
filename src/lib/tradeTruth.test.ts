import type { Trade } from '@/data/trades'
import {
  normalizeTradeMetrics,
  resolveTradeTruth,
  summarizeTradeResults,
  validateTradeResultEvidence,
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

export function testUnknownPnlBasisChecksDirectionWithoutInventingAValueConflict(): void {
  const validation = validateTradeResultEvidence({
    ...baseTrade,
    pnl: 100,
    rMultiple: 100,
    resultSource: 'imported',
    initialRiskAmount: 100,
    pnlBasis: 'unknown',
  })

  assert(validation.quality === 'confirmed', 'unknown basis evidence should remain confirmed')
  assert(
    !validation.issues.some((issue) => issue.code === 'pnl-r-value-conflict'),
    'unknown basis must not pretend cash can prove the R value',
  )
}

export function testNetPnlAndRiskDetectAConflictingRValue(): void {
  const validation = validateTradeResultEvidence({
    ...baseTrade,
    pnl: 100,
    rMultiple: 100,
    resultSource: 'imported',
    initialRiskAmount: 100,
    pnlBasis: 'net',
  })

  assert(validation.quality === 'conflict', 'a proven net PnL/R mismatch must be conflicting')
  assert(
    validation.issues.some((issue) => issue.code === 'pnl-r-value-conflict'),
    'the mismatch must expose a stable issue code',
  )
}

export function testMatchingNetPnlAndRiskBecomeVerifiedEvidence(): void {
  const validation = validateTradeResultEvidence({
    ...baseTrade,
    pnl: 200,
    rMultiple: 2,
    resultSource: 'imported',
    initialRiskAmount: 100,
    pnlBasis: 'net',
  })

  assert(validation.quality === 'verified', 'matching independent evidence should be verified')
  assert(validation.evidence.calculatedR === 2, 'calculated R should be exposed for explanations')
}

export function testRiskPercentageUsesPercentagePointsAndMustMatchAmount(): void {
  const matching = validateTradeResultEvidence({
    ...baseTrade,
    initialRiskAmount: 100,
    accountEquityAtEntry: 10_000,
    initialRiskPct: 1,
  })
  const conflicting = validateTradeResultEvidence({
    ...baseTrade,
    initialRiskAmount: 200,
    accountEquityAtEntry: 10_000,
    initialRiskPct: 1,
  })

  assert(
    !matching.issues.some((issue) => issue.code === 'risk-relationship-conflict'),
    '1 risk percent point of 10,000 should equal 100',
  )
  assert(
    conflicting.issues.some((issue) => issue.code === 'risk-relationship-conflict'),
    'inconsistent risk evidence must be diagnosed',
  )
}

export function testNonFiniteRiskEvidenceNeverSilentlyBecomesMissing(): void {
  const validation = validateTradeResultEvidence({
    ...baseTrade,
    initialRiskAmount: Number.NaN,
  })

  assert(
    validation.issues.some((issue) => issue.code === 'invalid-risk-evidence'),
    'non-finite risk evidence must be diagnosed instead of downgraded to missing',
  )
}

export function testCompleteCostsVerifyNetWithoutDoubleDeductingSlippage(): void {
  const validation = validateTradeResultEvidence({
    ...baseTrade,
    pnl: 90,
    rMultiple: null,
    resultSource: 'pnl',
    pnlBasis: 'net',
    grossPnl: 100,
    costs: {
      commission: 4,
      exchange: 1,
      financing: 2,
      tax: 0,
      other: 3,
      completeness: 'complete',
    },
    slippageCost: 25,
  })

  assert(validation.evidence.expectedNetPnl === 90, 'net should subtract serialized costs once')
  assert(validation.quality === 'verified', 'matching gross and net evidence should be verified')
}
