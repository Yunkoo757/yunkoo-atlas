import type { Trade } from '@/data/trades'

/** 路由参数：支持内部 id 或 TRD-xxx 编号 */
export function findTradeByRouteParam(
  trades: Trade[],
  param: string | undefined,
): Trade | undefined {
  if (!param) return undefined
  const exact = trades.find((t) => t.id === param)
  if (exact) return exact
  const upper = param.toUpperCase()
  return trades.find((t) => t.ref === param || t.ref.toUpperCase() === upper)
}

export function tradeDetailPath(trade: Pick<Trade, 'ref'>): string {
  return `/trade/${trade.ref}`
}
