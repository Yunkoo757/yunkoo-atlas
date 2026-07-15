import type { Trade } from '@/data/trades'
import { prepareTradeClose } from '@/lib/tradeClose'

const trade: Trade = {
  id: 'close-1',
  ref: 'TRD-1',
  symbol: 'EURUSD',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 95,
  size: 2,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-01',
  closedAt: null,
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testClosePriceWithoutStopRequiresAnotherResultMode(): void {
  const result = prepareTradeClose({ ...trade, stopLoss: null }, {
    outcome: 'loss',
    resultMode: 'price',
    pnl: null,
    rMultiple: null,
    exit: 110,
    closedAt: '2026-07-13',
  })

  assert(!result.ok, 'price mode without initial risk should ask for cash or R instead')
  if (result.ok) return
  assert(result.error.includes('止损'), 'the error should explain why price R is unavailable')
}

export function testCloseAcceptsEitherPnlOrRWithoutInventingTheOther(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'loss',
    resultMode: 'r',
    pnl: null,
    rMultiple: 1.5,
    exit: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'an explicit R result should be enough to close')
  if (!result.ok) return
  assert(result.patch.pnl === null, 'missing PnL must remain missing')
  assert(result.patch.rMultiple === -1.5, 'explicit R should be preserved')
  assert(result.status === 'loss', 'negative R should close as loss')
}

export function testCloseKeepsCashAndRTogetherWhenBothAreProvided(): void {
  const dualResult = {
    outcome: 'win' as const,
    resultMode: 'pnl' as const,
    pnl: 500,
    rMultiple: 2,
    exit: null,
    closedAt: '2026-07-13',
  }
  const result = prepareTradeClose(trade, dualResult)

  assert(result.ok, 'cash and R should be accepted together')
  if (!result.ok) return
  assert(result.patch.pnl === 500, 'cash PnL must be preserved')
  assert(result.patch.rMultiple === 2, 'R multiple must be preserved beside cash PnL')
  assert(result.patch.resultSource === 'imported', 'a confirmed cash and R pair should use paired authority')
}

export function testCloseKeepsCashResultAsTheOnlyAuthority(): void {
  const forexTrade = {
    ...trade,
    entry: 1.1,
    stopLoss: 1.095,
    size: 1,
    rMultiple: -1,
  }
  const result = prepareTradeClose(forexTrade, {
    outcome: 'win',
    resultMode: 'pnl',
    pnl: 1_000,
    rMultiple: null,
    exit: 1.11,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'an explicit cash result should not conflict with stale R data')
  if (!result.ok) return
  assert(result.patch.pnl === 1_000, 'explicit cash PnL should be preserved')
  assert(result.patch.rMultiple === null, 'cash mode must not invent or preserve an R result')
  assert(result.patch.resultSource === 'pnl', 'cash mode must persist PnL as the result authority')
}

export function testCloseAppliesLossDirectionToCashMagnitude(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'loss',
    resultMode: 'pnl',
    pnl: 500,
    rMultiple: null,
    exit: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'loss cash input should accept an unsigned magnitude')
  if (!result.ok) return
  assert(result.status === 'loss', 'loss selection should determine the result direction')
  assert(result.patch.pnl === -500, 'loss cash magnitude should be stored as a negative value')
}

export function testCloseKeepsRResultAsTheOnlyAuthority(): void {
  const result = prepareTradeClose({ ...trade, pnl: 500 }, {
    outcome: 'loss',
    resultMode: 'r',
    pnl: null,
    rMultiple: 1.5,
    exit: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'R mode should ignore stale cash data and accept an unsigned magnitude')
  if (!result.ok) return
  assert(result.patch.pnl === null, 'R mode must clear stale cash PnL')
  assert(result.patch.rMultiple === -1.5, 'loss R magnitude should be stored as a negative value')
  assert(result.patch.resultSource === 'r', 'R mode must persist R as the result authority')
}

export function testCloseSavesBreakevenWithoutExtraNumericInput(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'breakeven',
    resultMode: 'pnl',
    pnl: null,
    rMultiple: null,
    exit: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'breakeven should close without forcing a redundant zero input')
  if (!result.ok) return
  assert(result.status === 'breakeven', 'breakeven selection should remain authoritative')
  assert(result.patch.pnl === 0, 'cash mode should store an explicit breakeven result')
  assert(result.patch.rMultiple === 0, 'breakeven should persist a visible zero R beside cash')
}

export function testCloseDerivesPriceResultWithoutInventingCashPnl(): void {
  const forexTrade = {
    ...trade,
    entry: 1.1,
    stopLoss: 1.095,
    size: 1,
    pnl: 1_000,
    rMultiple: -1,
  }
  const result = prepareTradeClose(forexTrade, {
    outcome: 'loss',
    resultMode: 'price',
    pnl: null,
    rMultiple: null,
    exit: 1.11,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'price mode should derive a coherent result from execution prices')
  if (!result.ok) return
  assert(result.status === 'win', 'price direction should determine the closed outcome')
  assert(result.patch.pnl === null, 'price mode must not invent cash PnL without contract metadata')
  assert(result.patch.rMultiple === 2, 'price mode should calculate R from price risk directly')
  assert(result.patch.resultSource === 'price', 'price mode must persist price as the result authority')
  assert(result.patch.initialStopLoss === 1.095, 'price mode must freeze the initial risk used for R')
}

export function testPriceCloseUsesFrozenRiskAfterStopMoves(): void {
  const result = prepareTradeClose({
    ...trade,
    entry: 100,
    stopLoss: 99,
    initialStopLoss: 95,
  }, {
    outcome: 'win',
    resultMode: 'price',
    pnl: null,
    rMultiple: null,
    exit: 110,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'a moved stop should not block price close when initial risk is frozen')
  if (!result.ok) return
  assert(result.patch.rMultiple === 2, 'price close must calculate R from the frozen initial stop')
  assert(result.patch.initialStopLoss === 95, 'price close must preserve the frozen initial stop')
}

export function testCloseRejectsMissingPrimaryResult(): void {
  const missing = prepareTradeClose(trade, {
    outcome: 'win',
    resultMode: 'pnl',
    pnl: null,
    rMultiple: null,
    exit: null,
    closedAt: '2026-07-13',
  })
  const missingPrice = prepareTradeClose(trade, {
    outcome: 'win',
    resultMode: 'price',
    pnl: null,
    rMultiple: null,
    exit: null,
    closedAt: '2026-07-13',
  })

  assert(!missing.ok, 'cash mode should require a cash result')
  assert(!missingPrice.ok, 'price mode should require an exit price')
}
