import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { isAccountTrade } from '@/lib/tradeKind'
import { filterTradesByFacets, type TradeFacetFilters } from '@/lib/tradeView'
import { isHiddenWhenClosedFilter } from '@/lib/tradeStatus'
import {
  applyDisplayPrefs,
  filterTrades,
  parseTradeFacets,
} from '@/lib/workbenchTrades'
import { useStore } from '@/store/useStore'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'

/** 三视图共用：路由过滤 + 显示偏好 + URL 分面筛选 */
export function useWorkbenchVisibleTrades(filter: ListFilter): {
  trades: Trade[]
  visible: Trade[]
  facets: TradeFacetFilters
  workspaceCount: number
} {
  const storedTrades = useStore((state) => state.trades)
  const display = useStore((state) => state.display)
  const starredIds = useStore((state) => state.starredIds)
  const [searchParams] = useSearchParams()
  const localDateKey = useLocalDateKey()

  const trades = useMemo(
    () => storedTrades.filter((trade) => !trade.deletedAt),
    [storedTrades],
  )
  const facets = useMemo<TradeFacetFilters>(() => parseTradeFacets(searchParams), [searchParams])

  const workspaceCount = useMemo(
    () => trades.reduce(
      (count, trade) => count + Number(
        filter.tradeKind ? trade.tradeKind === filter.tradeKind : isAccountTrade(trade),
      ),
      0,
    ),
    [trades, filter.tradeKind],
  )

  const visible = useMemo(() => {
    const routeFiltered = filterTrades(trades, filter, starredIds)
    const prefs = facets.status && isHiddenWhenClosedFilter(facets.status)
      ? { ...display, hideClosed: false }
      : display
    return filterTradesByFacets(applyDisplayPrefs(routeFiltered, prefs, filter), facets)
  }, [
    trades,
    filter.type,
    filter.tradeKind,
    filter.strategyId,
    filter.period,
    filter.reviewCaseScope,
    localDateKey,
    starredIds,
    display,
    facets,
  ])

  return { trades, visible, facets, workspaceCount }
}
