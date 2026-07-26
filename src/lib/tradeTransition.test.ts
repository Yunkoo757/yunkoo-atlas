import type { Trade, TradeStatus } from '@/data/trades'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
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

export function testClosedTradingDayKeyPreservesDatesAndAppliesBoundaryOnlyToTimestamps(): void {
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27', 6) === '2026-07-27',
    '纯日期必须直接保留，不得受交易日起始小时影响',
  )
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27T05:59:00+08:00', 6) === '2026-07-26',
    '日界线前的带时区时间戳必须归入前一交易日',
  )
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27T06:00:00+08:00', 6) === '2026-07-27',
    '日界线后的带时区时间戳必须归入当日',
  )
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27T02:00:00-05:00', 6) === '2026-07-27',
    '负时区时间戳必须先按本地时刻解析，再应用交易日边界',
  )
  assert(closedTradingDayKeyFromClosedAt('2026-02-30', 6) === null, '非法日期必须拒绝')
}
