import type { Trade, TradeStatus } from '@/data/trades'
import { isExecutedClosed, isRowDone } from '@/lib/tradeStatus'
import { calcPnl, calcRSimple, pnlToStatus } from '@/lib/tradeCalc'

export type TradeTransitionActions = {
  updateTradeData: (
    id: string,
    patch: Partial<Pick<Trade, 'exit' | 'pnl' | 'rMultiple'>>,
  ) => void
  setStatus: (id: string, status: TradeStatus) => void
  toast: (msg: string) => void
}

function promptExit(ref: string): number | null {
  const exitStr = window.prompt(`${ref} 缺少出场价，请输入（取消则去详情页补全）`)
  if (!exitStr?.trim()) return null
  const parsed = parseFloat(exitStr)
  if (isNaN(parsed)) return null
  return parsed
}

/** 平仓前补全出场价与盈亏，返回是否可继续改状态 */
function ensureClosedTradeData(
  trade: Trade,
  actions: TradeTransitionActions,
  targetStatus?: 'win' | 'loss' | 'breakeven',
): boolean {
  if (!trade.entry || !trade.size) {
    actions.toast('请先在详情页补全入场价和仓位')
    return false
  }

  let exit = trade.exit
  if (exit == null) {
    const parsed = promptExit(trade.ref)
    if (parsed == null) {
      actions.toast('请先在详情页补全出场价和盈亏')
      return false
    }
    exit = parsed
  }

  let pnl = trade.pnl
  if (pnl === 0 && exit != null) {
    const suggested = calcPnl(trade.side, trade.entry, exit, trade.size)
    if (suggested != null) pnl = suggested
  }

  if (exit != null && (trade.exit !== exit || trade.pnl !== pnl)) {
    const patch: Partial<Pick<Trade, 'exit' | 'pnl' | 'rMultiple'>> = { exit, pnl }
    const r = calcRSimple(pnl, trade.entry, exit, trade.size)
    if (r != null) patch.rMultiple = r
    actions.updateTradeData(trade.id, patch)
  }

  const status = targetStatus ?? pnlToStatus(pnl)
  actions.setStatus(trade.id, status)
  return true
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
  ensureClosedTradeData(trade, actions)
}

/** 看板拖拽 / 菜单改状态 */
export function transitionTradeStatus(
  trade: Trade,
  nextStatus: TradeStatus,
  actions: TradeTransitionActions,
): void {
  if (trade.status === nextStatus) return

  if (nextStatus === 'open' || nextStatus === 'planned') {
    actions.setStatus(trade.id, nextStatus)
    return
  }

  if (nextStatus === 'missed') {
    actions.setStatus(trade.id, 'missed')
    return
  }

  if (isExecutedClosed(nextStatus)) {
    ensureClosedTradeData(trade, actions, nextStatus)
    return
  }

  actions.setStatus(trade.id, nextStatus)
}

/** 详情页修改盈亏后，同步已平仓状态标签 */
export function syncStatusFromPnl(
  trade: Trade,
  pnl: number,
  setStatus: (id: string, status: TradeStatus) => void,
): void {
  if (!isExecutedClosed(trade.status)) return
  const next = pnlToStatus(pnl)
  if (next !== trade.status) setStatus(trade.id, next)
}
