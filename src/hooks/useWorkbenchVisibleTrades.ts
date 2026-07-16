import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { isAccountTrade } from '@/lib/tradeKind'
import {
  deriveWorkbenchVisibleTrades,
  parseTradeFacets,
} from '@/lib/workbenchTrades'
import type { TradeFacetFilters } from '@/lib/tradeView'
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

  const facets = useMemo<TradeFacetFilters>(() => parseTradeFacets(searchParams), [searchParams])

  const derived = useMemo(() => deriveWorkbenchVisibleTrades({
    trades: storedTrades,
    filter,
    starredIds,
    display,
    search: searchParams,
  }), [
    storedTrades,
    filter.type,
    filter.tradeKind,
    filter.strategyId,
    filter.period,
    filter.reviewCaseScope,
    filter.analysisScope?.kind,
    filter.analysisScope?.range,
    localDateKey,
    starredIds,
    display,
    searchParams,
  ])
  const { trades, visible } = derived

  const workspaceCount = useMemo(
    () => trades.reduce(
      (count, trade) => count + Number(
        filter.tradeKind ? trade.tradeKind === filter.tradeKind : isAccountTrade(trade),
      ),
      0,
    ),
    [trades, filter.tradeKind],
  )

  return { trades, visible, facets, workspaceCount }
}
