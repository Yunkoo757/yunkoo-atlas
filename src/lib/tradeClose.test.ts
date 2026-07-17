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

export function testCloseAcceptsEitherPnlOrRWithoutInventingTheOther(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'loss',
    resultMode: 'r',
    pnl: null,
    rMultiple: 1.5,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'an explicit R result should be enough to close')
  if (!result.ok) return
  assert(result.patch.pnl === null, 'missing PnL must remain missing')
  assert(result.patch.rMultiple === -1.5, 'explicit R should be preserved')
  assert(result.status === 'loss', 'negative R should close as loss')
  assert(!('exit' in result.patch), 'close must not write exit price')
}

export function testCloseKeepsCashAndRTogetherWhenBothAreProvided(): void {
  const dualResult = {
    outcome: 'win' as const,
    resultMode: 'pnl' as const,
    pnl: 500,
    rMultiple: 2,
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
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'breakeven should close without forcing a redundant zero input')
  if (!result.ok) return
  assert(result.status === 'breakeven', 'breakeven selection should remain authoritative')
  assert(result.patch.pnl === 0, 'cash mode should store an explicit breakeven result')
  assert(result.patch.rMultiple === 0, 'breakeven should persist a visible zero R beside cash')
}

export function testCloseRejectsMissingPrimaryResult(): void {
  const missing = prepareTradeClose(trade, {
    outcome: 'win',
    resultMode: 'pnl',
    pnl: null,
    rMultiple: null,
    closedAt: '2026-07-13',
  })

  assert(!missing.ok, 'cash mode should require a cash result')
}

export function testClosePreservesExistingExitOnTrade(): void {
  const withExit = { ...trade, exit: 110 }
  const result = prepareTradeClose(withExit, {
    outcome: 'win',
    resultMode: 'pnl',
    pnl: 200,
    rMultiple: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'manual close should succeed without touching exit')
  if (!result.ok) return
  assert(!('exit' in result.patch), 'patch must omit exit so historical prices stay untouched')
}
