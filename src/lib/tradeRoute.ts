import type { Trade } from '@/data/trades'
import { routeWithSearch } from '@/lib/tradeView'
import {
  isCaseWorkspaceEntryPath,
  isTodayWorkspaceEntryPath,
  isTradeWorkspaceEntryPath,
} from '@/lib/workspaceViews'

export type TradeDetailFrom = {
  pathname: string
  search?: string
  anchorTradeId?: string
}

export type TradeDetailLocationState = {
  from?: TradeDetailFrom
}

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

export function tradeDetailNavState(from: TradeDetailFrom): TradeDetailLocationState {
  return {
    from: {
      pathname: from.pathname,
      search: from.search ?? '',
      ...(from.anchorTradeId ? { anchorTradeId: from.anchorTradeId } : {}),
    },
  }
}

/** 详情页返回目标：优先路由 state，其次列表上下文，最后按交易类型兜底 */
export function resolveTradeDetailReturn(options: {
  from?: TradeDetailFrom | null
  listPath?: string | null
  listSearch?: string | null
  tradeKind?: Trade['tradeKind']
}): { pathname: string; search: string } {
  const fallback = options.tradeKind === 'case' ? '/review-cases' : '/list'

  if (options.from?.pathname && isValidDetailSource(options.from.pathname, options.tradeKind)) {
    return routeWithSearch(options.from.pathname, options.from.search ?? '')
  }
  if (options.listPath && isValidDetailSource(options.listPath, options.tradeKind)) {
    return routeWithSearch(options.listPath, options.listSearch ?? '')
  }
  return routeWithSearch(fallback, '')
}

function isValidDetailSource(pathname: string, tradeKind: Trade['tradeKind'] | undefined): boolean {
  if (tradeKind === 'case') return isCaseWorkspaceEntryPath(pathname)
  if (isCaseWorkspaceEntryPath(pathname)) return false
  return (
    pathname === '/dashboard' ||
    isTodayWorkspaceEntryPath(pathname) ||
    isTradeWorkspaceEntryPath(pathname) ||
    pathname === '/sim' ||
    pathname.startsWith('/sim/')
  )
}
