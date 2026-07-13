import type { Trade, TradeStatus } from '@/data/trades'
import { isExecutedClosed, isRowDone } from '@/lib/tradeStatus'
import { pnlToStatus } from '@/lib/tradeCalc'

export type TradeTransitionActions = {
  setStatus: (id: string, status: TradeStatus) => void
  requestTradeClose: (
    tradeId: string,
    targetStatus?: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>,
  ) => void
  toast: (msg: string) => void
}

/** 列表行勾选：完成平仓或重新打开 */
export function toggleTradeDone(trade: Trade, actions: TradeTransitionActions): void {
  if (trade.status === 'missed') {
    actions.toast('错过记录请在详情页修改状态')
    return
  }
  if (isRowDone(trade.status)) {
    actions.setStatus(trade.id, 'open')
    return
  }
  actions.requestTradeClose(trade.id)
}

/** 看板拖拽 / 菜单改状态 */
export function transitionTradeStatus(
  trade: Trade,
  nextStatus: TradeStatus,
  actions: TradeTransitionActions,
): void {
  if (trade.status === nextStatus) return

  if (trade.tradeKind === 'case') {
    actions.setStatus(trade.id, nextStatus)
    return
  }

  if (nextStatus === 'open' || nextStatus === 'planned') {
    actions.setStatus(trade.id, nextStatus)
    return
  }

  if (nextStatus === 'missed') {
    actions.setStatus(trade.id, 'missed')
    return
  }

  if (isExecutedClosed(nextStatus)) {
    actions.requestTradeClose(trade.id, nextStatus)
    return
  }

  actions.setStatus(trade.id, nextStatus)
}

/** 详情页修改盈亏后，同步已平仓状态标签 */
export function syncStatusFromResult(
  trade: Trade,
  value: number,
  setStatus: (id: string, status: TradeStatus) => void,
): void {
  if (!isExecutedClosed(trade.status)) return
  const next = pnlToStatus(value)
  if (next !== trade.status) setStatus(trade.id, next)
}
