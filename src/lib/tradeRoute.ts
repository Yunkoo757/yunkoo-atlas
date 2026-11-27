import type { Trade } from '@/data/trades'
import { getJournalViewState, type JournalViewState } from '@/lib/journalQuickViews'
import type { CommandSearchSession } from '@/lib/commandDateSearch'
import { routeWithSearch } from '@/lib/tradeView'
import {
  isCaseWorkspaceEntryPath,
  isTodayWorkspaceEntryPath,
  isTradeWorkspaceEntryPath,
} from '@/lib/workspaceViews'

export type TradeDetailFrom = Partial<JournalViewState> & {
  pathname: string
  search?: string
  restoreSearch?: string
  anchorTradeId?: string
}

export type TradeDetailFocusField = 'closedAt' | 'result'

export type TradeDetailLocationState = {
  from?: TradeDetailFrom
  parentRecord?: { id: string; state: TradeDetailLocationState | null }
  commandSearch?: CommandSearchSession
  focusField?: TradeDetailFocusField
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

export function workbenchDetailFrom(
  location: { pathname: string; search: string; state: TradeDetailLocationState | null },
  anchorTradeId: string,
): TradeDetailFrom {
  const inherited = location.state?.from
  const archive = inherited && (inherited.pathname === '/live-history' ||
    inherited.pathname === '/live-archive' || inherited.pathname.startsWith('/live-archive/'))
  return {
    pathname: archive ? inherited.pathname : location.pathname,
    search: archive ? inherited.search ?? '' : location.search,
    ...getJournalViewState(location.state),
    anchorTradeId,
  }
}

/** 从详情打开关联记录时保留上一级的入口；反向打开原记录可直接还原。 */
export function relatedTradeDetailState(
  parentId: string,
  targetId: string,
  current: TradeDetailLocationState | null,
): TradeDetailLocationState | null {
  if (current?.parentRecord?.id === targetId) return current.parentRecord.state
  return { parentRecord: { id: parentId, state: current }, from: current?.from, commandSearch: current?.commandSearch }
}

export function tradeDetailNavState(
  from: TradeDetailFrom,
  extras?: Pick<TradeDetailLocationState, 'focusField'>,
): TradeDetailLocationState {
  return {
    from: {
      pathname: from.pathname,
      search: from.search ?? '',
      ...(from.restoreSearch !== undefined ? { restoreSearch: from.restoreSearch } : {}),
      ...(from.anchorTradeId ? { anchorTradeId: from.anchorTradeId } : {}),
      ...(from.journalView ? { journalView: from.journalView } : {}),
    },
    ...(extras?.focusField ? { focusField: extras.focusField } : {}),
  }
}

/** 详情页返回目标：优先路由 state，其次列表上下文，最后按交易类型兜底 */
export function resolveTradeDetailReturn(options: {
  from?: TradeDetailFrom | null
  listPath?: string | null
  listSearch?: string | null
  tradeKind?: Trade['tradeKind']
  backtestProjectId?: string
}): { pathname: string; search: string } {
  const fallback = options.tradeKind === 'backtest' ? (options.backtestProjectId ? `/backtests/${encodeURIComponent(options.backtestProjectId)}` : '/backtests') : options.tradeKind === 'case' ? '/review-cases' : '/list'

  if (options.from?.pathname && isValidDetailSource(options.from.pathname, options.tradeKind, options.from.anchorTradeId)) {
    return routeWithSearch(
      options.from.pathname,
      options.from.restoreSearch ?? options.from.search ?? '',
    )
  }
  if (options.listPath && isValidDetailSource(options.listPath, options.tradeKind)) {
    return routeWithSearch(options.listPath, options.listSearch ?? '')
  }
  return routeWithSearch(fallback, '')
}

function isValidDetailSource(pathname: string, tradeKind: Trade['tradeKind'] | undefined, anchorTradeId?: string): boolean {
  if (/^\/backtests\/[^/]+$/.test(pathname)) return tradeKind === 'backtest' || tradeKind === 'case'
  if (tradeKind === 'backtest') return false
  if (/^\/notes\/[^/]+$/.test(pathname)) return tradeKind === 'live' || tradeKind === 'case'
  if (pathname === '/dashboard') return tradeKind !== 'case'
  if (pathname === '/live-history' || pathname === '/live-history/board') return true
  if (pathname === '/live-archive' || pathname.startsWith('/live-archive/')) return true
  if (pathname === '/missed') return true
  if (pathname === '/review-session') return true
  if (pathname === '/settings/risk') return tradeKind === 'live'
  if (pathname === '/settings/risk/data-repair') {
    return tradeKind === 'live' || tradeKind === undefined
  }
  if (pathname === '/weekly-review') {
    return tradeKind === 'live' || tradeKind === undefined ||
      (tradeKind === 'case' && anchorTradeId?.startsWith('weekly-commitment:') === true)
  }
  if (tradeKind === 'case') return isCaseWorkspaceEntryPath(pathname)
  if (isCaseWorkspaceEntryPath(pathname)) return false
  return (
    isTodayWorkspaceEntryPath(pathname) ||
    isTradeWorkspaceEntryPath(pathname) ||
    pathname === '/sim' ||
    pathname.startsWith('/sim/')
  )
}
