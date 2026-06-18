import type { Trade } from '@/data/trades'
import {
  applyDisplayPrefs,
  filterTrades,
  DEFAULT_DISPLAY,
  type ListFilter,
  type DisplayPrefs,
} from '@/lib/tradeFilters'
import type { ListNavigationContext } from '@/shortcuts/types'

export function buildOrderedTradeIds(
  trades: Trade[],
  filter: ListFilter,
  display: DisplayPrefs,
  starredIds: string[],
): string[] {
  const filtered = filterTrades(trades, filter, starredIds)
  const visible = applyDisplayPrefs(filtered, display, filter)
  return visible.map((t) => t.id)
}

export function buildListNavigationContext(
  trades: Trade[],
  filter: ListFilter,
  display: DisplayPrefs,
  starredIds: string[],
  listPath: string,
): ListNavigationContext {
  return {
    filter,
    listPath,
    orderedIds: buildOrderedTradeIds(trades, filter, display, starredIds),
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

/** 无列表上下文时，按全量 live 交易日期排序兜底 */
export function fallbackAdjacentTradeId(
  trades: Trade[],
  currentTradeId: string | undefined,
  direction: 'prev' | 'next',
): string | null {
  if (!currentTradeId) return null
  const ordered = applyDisplayPrefs(
    filterTrades(trades, { type: 'all', tradeKind: 'live' }, []),
    DEFAULT_DISPLAY,
    { type: 'all', tradeKind: 'live' },
  )
  const ids = ordered.map((t) => t.id)
  const idx = ids.indexOf(currentTradeId)
  if (idx < 0) return null
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1
  if (nextIdx < 0 || nextIdx >= ids.length) return null
  return ids[nextIdx] ?? null
}
