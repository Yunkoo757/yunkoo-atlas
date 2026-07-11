import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ReviewCategory, Trade, TradeSide, TradeStatus } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { applyDisplayPrefs, filterTrades } from '@/lib/tradeFilters'
import { CALENDAR_PERIODS, type CalendarPeriod } from '@/lib/periods'
import { STATUS_ORDER, isHiddenWhenClosedFilter } from '@/lib/tradeStatus'
import {
  filterTradesByFacets,
  type TradeFacetFilters,
  type TradeSessionKind,
} from '@/lib/tradeView'
import { useStore } from '@/store/useStore'

const REVIEW_CATEGORIES: ReviewCategory[] = [
  'normal',
  'mistake',
  'focus',
  'ambiguous',
  'recheck',
  'mastered',
]

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

  const facets = useMemo<TradeFacetFilters>(() => {
    const side = searchParams.get('side')
    const status = searchParams.get('status')
    const reviewCategory = searchParams.get('reviewCategory')
    const session = searchParams.get('session')
    const period = searchParams.get('period')
    return {
      symbol: searchParams.get('symbol') || undefined,
      side: side === 'long' || side === 'short' ? (side as TradeSide) : undefined,
      status: STATUS_ORDER.includes(status as TradeStatus) ? (status as TradeStatus) : undefined,
      tag: searchParams.get('tag') || undefined,
      mistakeTag: searchParams.get('mistakeTag') || undefined,
      reviewCategory: REVIEW_CATEGORIES.includes(reviewCategory as ReviewCategory)
        ? (reviewCategory as ReviewCategory)
        : undefined,
      session: ['london', 'asia', 'new-york', 'outside', 'other'].includes(session ?? '')
        ? (session as TradeSessionKind)
        : undefined,
      period: CALENDAR_PERIODS.includes(period as CalendarPeriod)
        ? (period as CalendarPeriod)
        : undefined,
      strategyId: searchParams.get('strategyId') || undefined,
    }
  }, [searchParams])

  const visible = useMemo(() => {
    const routeFiltered = filterTrades(trades, filter, starredIds)
    // 用户显式筛选已平仓状态时，不能再被「隐藏已平仓」吃掉（否则亏损/盈利条件会变成空列表）
    const prefs =
      facets.status && isHiddenWhenClosedFilter(facets.status)
        ? { ...display, hideClosed: false }
        : display
    const preferred = applyDisplayPrefs(routeFiltered, prefs, filter)
    return filterTradesByFacets(preferred, facets)
  }, [trades, filter, starredIds, display, facets])

  return { trades, visible, facets }
}
