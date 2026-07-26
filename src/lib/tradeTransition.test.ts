import type { Trade, TradeStatus } from '@/data/trades'
import { getTradingDayKey } from '@/lib/periods'
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
  let openRequest: string | null = null
  let closeRequest: { tradeId: string; targetStatus?: 'win' | 'loss' | 'breakeven' } | null = null
  const actions: TradeTransitionActions = {
    setStatus: (_id, nextStatus) => { status = nextStatus },
    requestTradeOpen: (tradeId) => { openRequest = tradeId },
    requestTradeClose: (tradeId, targetStatus) => { closeRequest = { tradeId, targetStatus } },
    toast: () => {},
  }
  return {
    actions,
    getStatus: () => status,
    getOpenRequest: () => openRequest,
    getCloseRequest: () => closeRequest,
  }
}

export function testOpenTransitionAlwaysUsesRiskGateRequest(): void {
  const tracker = trackedActions()
  transitionTradeStatus({ ...baseTrade, status: 'missed' }, 'open', tracker.actions)

  assert(tracker.getOpenRequest() === baseTrade.id, 'open 必须统一调用 requestTradeOpen')
  assert(tracker.getStatus() === null, 'open 不得退回公开 setStatus')
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
    closedTradingDayKeyFromClosedAt('2026-07-27T05:59:00+08:00', 6) ===
      getTradingDayKey(new Date('2026-07-27T05:59:00+08:00'), 6),
    '带时区时间戳必须按设备本地时区与交易日边界归属',
  )
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27T06:00:00+08:00', 6) ===
      getTradingDayKey(new Date('2026-07-27T06:00:00+08:00'), 6),
    '带时区时间戳必须使用与交易日一致的设备本地时区',
  )
  assert(
    closedTradingDayKeyFromClosedAt('2026-07-27T02:00:00-05:00', 6) ===
      getTradingDayKey(new Date('2026-07-27T02:00:00-05:00'), 6),
    '负时区时间戳也必须按设备本地时区归属',
  )
  assert(closedTradingDayKeyFromClosedAt('2026-02-30', 6) === null, '非法日期必须拒绝')
}
