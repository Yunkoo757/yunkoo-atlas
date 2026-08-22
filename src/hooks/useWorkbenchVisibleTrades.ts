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
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import {
  filterStageOwnedRecords,
  resolveStageScope,
  type StageScope,
} from '@/lib/stageArchive'

/** 三视图共用：路由过滤 + 显示偏好 + URL 分面筛选 */
export function useWorkbenchVisibleTrades(filter: ListFilter): {
  trades: Trade[]
  visible: Trade[]
  facets: TradeFacetFilters
  totalCount: number
  workspaceCount: number
  businessDateAnchor: ReturnType<typeof useBusinessDateAnchor>
} {
  const storedTrades = useStore((state) => state.trades)
  const display = useStore((state) => state.display)
  const starredIds = useStore((state) => state.starredIds)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const [searchParams] = useSearchParams()
  const businessDateAnchor = useBusinessDateAnchor()
  const localDateKey = businessDateAnchor.currentTradingDayKey

  const facets = useMemo<TradeFacetFilters>(() => parseTradeFacets(searchParams), [searchParams])
  const stageScope = useMemo<StageScope | undefined>(() => {
    if (filter.tradeKind === 'paper' || filter.analysisScope?.kind === 'paper') return undefined
    if (filter.historicalLiveScope) {
      return resolveStageScope(
        searchParams.get('liveStage'),
        liveStages,
        currentLiveStageId,
        'history',
      )
    }
    return { kind: 'current', stageId: currentLiveStageId }
  }, [currentLiveStageId, filter.analysisScope?.kind, filter.historicalLiveScope, filter.tradeKind, liveStages, searchParams])

  const derived = useMemo(() => deriveWorkbenchVisibleTrades({
    trades: storedTrades,
    filter,
    starredIds,
    display,
    search: searchParams,
    businessDateAnchor,
    stageScope,
  }), [
    storedTrades,
    filter.type,
    filter.tradeKind,
    filter.strategyId,
    filter.period,
    filter.reviewCaseScope,
    filter.historicalLiveScope,
    filter.analysisScope?.kind,
    filter.analysisScope?.range,
    localDateKey,
    starredIds,
    display,
    stageScope,
    searchParams,
  ])
  const { trades, visible } = derived

  const { totalCount, workspaceCount } = useMemo(() => {
    let total = 0
    let workspace = 0
    const workspaceTrades = stageScope
      ? filterStageOwnedRecords(storedTrades, stageScope)
      : storedTrades
    for (const trade of workspaceTrades) {
      if (trade.deletedAt) continue
      total += 1
      if (filter.tradeKind ? trade.tradeKind === filter.tradeKind : isAccountTrade(trade)) {
        workspace += 1
      }
    }
    return {
      totalCount: total,
      workspaceCount: filter.historicalLiveScope ? trades.length : workspace,
    }
  }, [storedTrades, filter.tradeKind, filter.historicalLiveScope, stageScope, trades.length])

  return { trades, visible, facets, totalCount, workspaceCount, businessDateAnchor }
}
