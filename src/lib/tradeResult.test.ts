import type { Trade } from '@/data/trades'
import { prepareTradeResultEdit } from '@/lib/tradeResult'
import { normalizeTrades } from '@/lib/tradeKind'

const trade: Trade = {
  id: 'result-1',
  ref: 'TRD-1',
  symbol: 'EURUSD',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 1.1,
  exit: 1.11,
  stopLoss: 1.095,
  size: 1,
  pnl: 1_000,
  rMultiple: null,
  resultSource: 'pnl',
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testExecutionEditsNeverOverwriteAnExplicitCashResult(): void {
  const result = prepareTradeResultEdit(trade, {
    kind: 'execution',
    patch: { exit: 1.12 },
  })

  assert(result.patch.exit === 1.12, 'the edited execution field should be preserved')
  assert(result.patch.pnl === undefined, 'execution edits must not rewrite authoritative cash PnL')
  assert(result.patch.rMultiple === undefined, 'execution edits must not invent an R result')
  assert(result.status === undefined, 'execution edits must not change an explicit cash outcome')
}

export function testPriceAuthorityRecalculatesRAndOutcomeFromExecutionPrices(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
  }, {
    kind: 'execution',
    patch: { exit: 1.09 },
  })

  assert(result.patch.exit === 1.09, 'the edited exit should be preserved')
  assert(result.patch.pnl === null, 'price authority must not invent cash PnL')
  assert(result.patch.rMultiple === -2, 'R should be recalculated from entry, stop and exit prices')
  assert(result.status === 'loss', 'the price direction should become the closed outcome')
}

export function testPriceAuthorityKeepsInitialRiskWhenStopIsEditedLater(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    initialStopLoss: 1.095,
  }, {
    kind: 'execution',
    patch: { stopLoss: 1.099 },
  })

  assert(result.patch.stopLoss === 1.099, 'the current stop should still be editable')
  assert(result.patch.rMultiple === 2, 'editing the current stop must not rewrite historical initial risk')
}

export function testFirstStopLossEditFreezesTheInitialRisk(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    status: 'open',
    stopLoss: null,
    initialStopLoss: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  }, {
    kind: 'execution',
    patch: { stopLoss: 1.095 },
  })

  assert(result.patch.stopLoss === 1.095, 'the first stop should be saved')
  assert(
    result.patch.initialStopLoss === 1.095,
    'the first valid stop should also become the immutable initial risk',
  )
}

export function testFirstLegacyStopMoveFreezesThePreviousStop(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    status: 'open',
    stopLoss: 1.095,
    initialStopLoss: undefined,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  }, {
    kind: 'execution',
    patch: { stopLoss: 1.099 },
  })

  assert(result.patch.stopLoss === 1.099, 'the moved stop should remain the current stop')
  assert(
    result.patch.initialStopLoss === 1.095,
    'a legacy record must freeze the stop that existed before its first move',
  )
}

export function testLegacyPriceStopMoveRecalculatesFromTheFrozenPreviousStop(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    initialStopLoss: undefined,
  }, {
    kind: 'execution',
    patch: { stopLoss: 1.099 },
  })

  assert(result.patch.initialStopLoss === 1.095, 'the previous stop should freeze first')
  assert(result.patch.rMultiple === 2, 'the same edit must calculate R from that frozen stop')
}

export function testLoadedLegacyTradeFreezesItsBestKnownInitialStop(): void {
  const [normalized] = normalizeTrades([{
    ...trade,
    initialStopLoss: undefined,
  }])

  assert(
    normalized?.initialStopLoss === trade.stopLoss,
    'loading a legacy or imported trade should preserve its best known stop as initial risk',
  )
}

export function testPriceAuthorityRecalculatesWhenSideChanges(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    initialStopLoss: 1.105,
  }, {
    kind: 'execution',
    patch: { side: 'short' },
  })

  assert(result.patch.side === 'short', 'the edited side should be preserved')
  assert(result.patch.rMultiple === -2, 'side changes must recalculate the price-derived R')
  assert(result.status === 'loss', 'side changes must synchronize the price-derived outcome')
}

export function testIncompletePriceEditClearsPriceAuthority(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    initialStopLoss: 1.095,
  }, {
    kind: 'execution',
    patch: { exit: null },
  })

  assert(result.patch.exit === null, 'clearing the exit should remain an intentional edit')
  assert(result.patch.rMultiple === null, 'incomplete prices cannot retain a derived R')
  assert(result.patch.resultSource === undefined, 'incomplete prices must clear price authority')
  assert(result.status === undefined, 'incomplete prices cannot invent a closed outcome')
}

export function testEditingCashResultClearsStaleRAndBecomesAuthoritative(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    status: 'loss',
    pnl: null,
    rMultiple: -1,
    resultSource: 'r',
  }, {
    kind: 'result',
    source: 'pnl',
    value: 500,
  })

  assert(result.patch.pnl === 500, 'the explicit cash result should be preserved')
  assert(result.patch.rMultiple === null, 'switching authority must clear stale R')
  assert(result.patch.resultSource === 'pnl', 'cash must become the only result authority')
  assert(result.status === 'win', 'the authoritative metric should synchronize the outcome')
}

export function testEditingMissedResultKeepsMissedWorkflowIsolated(): void {
  const result = prepareTradeResultEdit({
    ...trade,
    status: 'missed',
    missReason: 'hesitation',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  }, {
    kind: 'result',
    source: 'r',
    value: 2,
  })

  assert(result.patch.rMultiple === 2, 'the hypothetical missed result may still be recorded')
  assert(result.status === undefined, 'editing a missed result must never turn it into an executed win')
}
