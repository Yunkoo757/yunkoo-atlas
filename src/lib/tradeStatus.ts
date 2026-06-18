import type { Trade, TradeStatus } from '@/data/trades'

/** 列表/看板分组与菜单顺序 */
export const STATUS_ORDER: TradeStatus[] = [
  'planned',
  'open',
  'missed',
  'win',
  'breakeven',
  'loss',
]

/** 进行中：计划中或持仓中 */
export function isActive(status: TradeStatus): boolean {
  return status === 'planned' || status === 'open'
}

/** 已执行并平仓（计入胜率 / 权益曲线） */
export function isExecutedClosed(status: TradeStatus): boolean {
  return status === 'win' || status === 'loss' || status === 'breakeven'
}

/** 错过机会（终态、假设盈亏） */
export function isMissed(status: TradeStatus): boolean {
  return status === 'missed'
}

/** 终态（含错过），可写 closedAt */
export function isTerminal(status: TradeStatus): boolean {
  return isExecutedClosed(status) || isMissed(status)
}

/** 显示偏好「隐藏已平仓」时排除的状态（不含错过） */
export function isHiddenWhenClosedFilter(status: TradeStatus): boolean {
  return isExecutedClosed(status)
}

export function isHypothetical(status: TradeStatus): boolean {
  return status === 'missed'
}

/** 列表行「完成」勾选样式 */
export function isRowDone(status: TradeStatus): boolean {
  return isExecutedClosed(status)
}

export function filterExecutedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => isExecutedClosed(t.status))
}

export function filterByTradeKind(
  trades: Trade[],
  kinds: Trade['tradeKind'][] | 'all',
): Trade[] {
  if (kinds === 'all') return trades
  const set = new Set(kinds)
  return trades.filter((t) => set.has(t.tradeKind))
}
