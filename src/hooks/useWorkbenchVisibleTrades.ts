import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { isAccountTrade } from '@/lib/tradeKind'
import {
  deriveWorkbenchVisibleTrades,
  filterTrades,
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
  stageScope: StageScope | undefined
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
    if (filter.strategySources?.some((source) => source !== 'trade')) return undefined
    if (filter.tradeKind === 'paper' || filter.analysisScope?.kind === 'paper') return undefined
    if (filter.tradeKind === 'case' && !filter.historicalLiveScope) return undefined
    if (filter.historicalLiveScope) {
      return resolveStageScope(
        searchParams.get('liveStage'),
        liveStages,
        currentLiveStageId,
        'history',
      )
    }
    return { kind: 'current', stageId: currentLiveStageId }
  }, [
    currentLiveStageId,
    filter.analysisScope?.kind,
    filter.historicalLiveScope,
    filter.strategySources,
    filter.tradeKind,
    liveStages,
    searchParams,
  ])

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
    filter.strategySources,
    filter.liveStageId,
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
    for (const trade of storedTrades) {
      if (!trade.deletedAt) total += 1
    }
    if (filter.strategySources?.length) {
      workspace = filterTrades(
        storedTrades.filter((trade) => !trade.deletedAt),
        filter,
        starredIds,
        display.tradingDayStartHour,
        businessDateAnchor,
      ).length
    } else {
      const workspaceTrades = stageScope
        ? filterStageOwnedRecords(storedTrades, stageScope)
        : storedTrades
      for (const trade of workspaceTrades) {
        if (trade.deletedAt) continue
        if (filter.tradeKind ? trade.tradeKind === filter.tradeKind : isAccountTrade(trade)) {
          workspace += 1
        }
      }
    }
    return {
      totalCount: total,
      workspaceCount: filter.historicalLiveScope ? trades.length : workspace,
    }
  }, [
    businessDateAnchor,
    display.tradingDayStartHour,
    filter,
    filter.historicalLiveScope,
    filter.strategySources,
    filter.tradeKind,
    stageScope,
    starredIds,
    storedTrades,
    trades.length,
  ])

  return { trades, visible, facets, totalCount, workspaceCount, businessDateAnchor, stageScope }
}
