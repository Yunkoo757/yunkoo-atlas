import type { Trade, TradeStatus } from '@/data/trades'
import { transitionTradeStatus, type TradeTransitionActions } from '@/lib/tradeTransition'

const baseTrade: Trade = {
  id: 'transition-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'planned',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 95,
  size: 1,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-13',
  closedAt: null,
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function trackedActions() {
  let status: TradeStatus | null = null
  let closeRequest: { tradeId: string; targetStatus?: 'win' | 'loss' | 'breakeven' } | null = null
  const actions: TradeTransitionActions = {
    setStatus: (_id, nextStatus) => { status = nextStatus },
    requestTradeClose: (tradeId, targetStatus) => { closeRequest = { tradeId, targetStatus } },
    toast: () => {},
  }
  return { actions, getStatus: () => status, getCloseRequest: () => closeRequest }
}

export function testCaseOutcomeChangesWithoutOpeningTradeCloseDialog(): void {
  const tracker = trackedActions()
  transitionTradeStatus({ ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' }, 'win', tracker.actions)

  assert(tracker.getStatus() === 'win', 'case outcome should update directly')
  assert(tracker.getCloseRequest() === null, 'case outcome must not open the trade close dialog')
}

export function testExecutedTradeOutcomeStillRequiresTradeCloseDialog(): void {
  const tracker = trackedActions()
  transitionTradeStatus(baseTrade, 'win', tracker.actions)

  assert(tracker.getStatus() === null, 'executed trade outcome must not bypass close validation')
  assert(
    tracker.getCloseRequest()?.tradeId === baseTrade.id && tracker.getCloseRequest()?.targetStatus === 'win',
    'executed trade outcome should open the close dialog with the requested result',
  )
}
