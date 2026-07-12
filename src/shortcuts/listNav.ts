import type { Trade } from '@/data/trades'
import {
  DEFAULT_DISPLAY,
  type ListFilter,
  type DisplayPrefs,
} from '@/lib/tradeFilters'
import { getWorkbenchVisibleTrades } from '@/lib/workbenchTrades'
import type { ListNavigationContext } from '@/shortcuts/types'

/** 与工作台列表同一可见规则（含软删过滤、hideClosed 与 URL 筛选覆盖） */
export function buildOrderedTradeIds(
  trades: Trade[],
  filter: ListFilter,
  display: DisplayPrefs,
  starredIds: string[],
  search: string | URLSearchParams = '',
): string[] {
  return getWorkbenchVisibleTrades({
    trades,
    filter,
    starredIds,
    display,
    search,
  }).map((t) => t.id)
}

export function buildListNavigationContext(
  trades: Trade[],
  filter: ListFilter,
  display: DisplayPrefs,
  starredIds: string[],
  listPath: string,
  listSearch = '',
): ListNavigationContext {
  return {
    filter,
    listPath,
    listSearch,
    orderedIds: buildOrderedTradeIds(trades, filter, display, starredIds, listSearch),
  }
}

export function findAdjacentTradeId(
  ctx: ListNavigationContext | null,
  currentTradeId: string | undefined,
  direction: 'prev' | 'next',
): string | null {
  if (!ctx || !currentTradeId) return null
  const idx = ctx.orderedIds.indexOf(currentTradeId)
  if (idx < 0) return null
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1
  if (nextIdx < 0 || nextIdx >= ctx.orderedIds.length) return null
  return ctx.orderedIds[nextIdx] ?? null
}

/** 无列表上下文时，按全量 live 交易的工作台可见规则兜底 */
export function fallbackAdjacentTradeId(
  trades: Trade[],
  currentTradeId: string | undefined,
  direction: 'prev' | 'next',
): string | null {
  if (!currentTradeId) return null
  const ids = buildOrderedTradeIds(
    trades,
    { type: 'all', tradeKind: 'live' },
    DEFAULT_DISPLAY,
    [],
    '',
  )
  const idx = ids.indexOf(currentTradeId)
  if (idx < 0) return null
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1
  if (nextIdx < 0 || nextIdx >= ids.length) return null
  return ids[nextIdx] ?? null
}
