import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import type { TradeFacetFilters } from '@/lib/tradeView'
import { getWorkbenchVisibleTrades, parseTradeFacets } from '@/lib/workbenchTrades'
import { useStore } from '@/store/useStore'

/** 三视图共用：路由过滤 + 显示偏好 + URL 分面筛选 */
export function useWorkbenchVisibleTrades(filter: ListFilter): {
  trades: Trade[]
  visible: Trade[]
  facets: TradeFacetFilters
} {
  const trades = useStore((state) => state.trades).filter((trade) => !trade.deletedAt)
  const display = useStore((state) => state.display)
  const starredIds = useStore((state) => state.starredIds)
  const [searchParams] = useSearchParams()

  const facets = useMemo<TradeFacetFilters>(() => parseTradeFacets(searchParams), [searchParams])

  const visible = useMemo(() => {
    return getWorkbenchVisibleTrades({ trades, filter, starredIds, display, search: searchParams })
  }, [trades, filter, starredIds, display, searchParams])

  return { trades, visible, facets }
}
