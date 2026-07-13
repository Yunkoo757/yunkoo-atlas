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

export function testCloseCalculatesMetricsFromExecutionPrices(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'win',
    exit: 110,
    pnl: null,
    rMultiple: null,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'valid execution prices should close the trade')
  if (!result.ok) return
  assert(result.status === 'win', 'positive result should close as win')
  assert(result.patch.pnl === 20, 'PnL should be calculated from entry, exit and size')
  assert(result.patch.rMultiple === 2, 'R should use the initial stop risk')
  assert(result.patch.reviewStatus === 'unreviewed', 'closing should enter the review queue')
}

export function testCloseAcceptsEitherPnlOrRWithoutInventingTheOther(): void {
  const result = prepareTradeClose(trade, {
    outcome: 'loss',
    exit: null,
    pnl: null,
    rMultiple: -1.5,
    closedAt: '2026-07-13',
  })

  assert(result.ok, 'an explicit R result should be enough to close')
  if (!result.ok) return
  assert(result.patch.pnl === null, 'missing PnL must remain missing')
  assert(result.patch.rMultiple === -1.5, 'explicit R should be preserved')
  assert(result.status === 'loss', 'negative R should close as loss')
}

export function testCloseRejectsMissingOrConflictingResults(): void {
  const missing = prepareTradeClose(trade, {
    outcome: 'win',
    exit: null,
    pnl: null,
    rMultiple: null,
    closedAt: '2026-07-13',
  })
  const conflict = prepareTradeClose(trade, {
    outcome: 'win',
    exit: null,
    pnl: -20,
    rMultiple: 2,
    closedAt: '2026-07-13',
  })

  assert(!missing.ok, 'close must capture PnL, R or enough prices to calculate them')
  assert(!conflict.ok, 'contradictory metrics must not be saved')
}

