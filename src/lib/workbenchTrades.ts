import type { ReviewCategory, Trade, TradeSide, TradeStatus } from '@/data/trades'
import { isAccountTrade } from '@/lib/tradeKind'
import type { DisplayPrefs, ListFilter } from '@/lib/tradeFilters'
import { CALENDAR_PERIODS, tradeInPeriod, type CalendarPeriod } from '@/lib/periods'
import { isActive, isHiddenWhenClosedFilter, isMissed, STATUS_ORDER } from '@/lib/tradeStatus'
import {
  filterTradesByFacets,
  type TradeFacetFilters,
  type TradeSessionKind,
} from '@/lib/tradeView'

const REVIEW_CATEGORIES: ReviewCategory[] = [
  'normal',
  'mistake',
  'focus',
  'ambiguous',
  'recheck',
  'mastered',
]

const TRADE_SESSIONS: TradeSessionKind[] = [
  'london',
  'asia',
  'new-york',
  'outside',
  'other',
]

const CONVICTION_RANK: Record<Trade['conviction'], number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function parseTradeFacets(search: string | URLSearchParams): TradeFacetFilters {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const side = params.get('side')
  const status = params.get('status')
  const reviewCategory = params.get('reviewCategory')
  const session = params.get('session')
  const period = params.get('period')
  return {
    symbol: params.get('symbol') || undefined,
    side: side === 'long' || side === 'short' ? (side as TradeSide) : undefined,
    status: STATUS_ORDER.includes(status as TradeStatus) ? (status as TradeStatus) : undefined,
    tag: params.get('tag') || undefined,
    mistakeTag: params.get('mistakeTag') || undefined,
    reviewCategory: REVIEW_CATEGORIES.includes(reviewCategory as ReviewCategory)
      ? (reviewCategory as ReviewCategory)
      : undefined,
    session: TRADE_SESSIONS.includes(session as TradeSessionKind)
      ? (session as TradeSessionKind)
      : undefined,
    period: CALENDAR_PERIODS.includes(period as CalendarPeriod)
      ? (period as CalendarPeriod)
      : undefined,
    strategyId: params.get('strategyId') || undefined,
  }
}

function filterByListTarget(trades: Trade[], filter: ListFilter, starredIds: string[]): Trade[] {
  let visible = trades
  if (filter.type === 'active') visible = trades.filter((trade) => isActive(trade.status))
  if (filter.type === 'starred') visible = trades.filter((trade) => starredIds.includes(trade.id))
  if (filter.type === 'missed') visible = trades.filter((trade) => isMissed(trade.status))
  if (filter.type === 'strategy' && filter.strategyId) {
    visible = trades.filter((trade) => trade.strategyId === filter.strategyId)
  }
  if (filter.type === 'period' && filter.period) {
    visible = trades.filter((trade) => tradeInPeriod(trade, filter.period!))
  }

  visible = filter.tradeKind
    ? visible.filter((trade) => trade.tradeKind === filter.tradeKind)
    : visible.filter(isAccountTrade)

  if (filter.tradeKind !== 'case' || !filter.reviewCaseScope || filter.reviewCaseScope === 'all') {
    return visible
  }
  return visible.filter((trade) => {
    if (filter.reviewCaseScope === 'focus') {
      return trade.reviewCategory === 'focus' || trade.reviewStatus === 'focus'
    }
    if (filter.reviewCaseScope === 'mistakes') {
      return (
        trade.reviewCategory === 'mistake' ||
        trade.reviewCategory === 'ambiguous' ||
        trade.status === 'missed' ||
        trade.mistakeTags.length > 0
      )
    }
    if (filter.reviewCaseScope === 'unreviewed') {
      return trade.reviewCategory === 'recheck' || trade.reviewStatus === 'unreviewed'
    }
    return trade.reviewCategory === 'mastered' || trade.reviewStatus === 'reviewed'
  })
}

function applyWorkbenchDisplayPrefs(
  trades: Trade[],
  display: DisplayPrefs,
  filter: ListFilter,
  status: TradeStatus | undefined,
): Trade[] {
  const skipHideClosed =
    filter.type === 'missed' ||
    filter.tradeKind === 'case' ||
    Boolean(status && isHiddenWhenClosedFilter(status))
  const visible = display.hideClosed && !skipHideClosed
    ? trades.filter((trade) => !isHiddenWhenClosedFilter(trade.status))
    : [...trades]
  return visible.sort((left, right) => {
    if (display.sortBy === 'pnl') return right.pnl - left.pnl
    if (display.sortBy === 'conviction') {
      return CONVICTION_RANK[right.conviction] - CONVICTION_RANK[left.conviction]
    }
    return +new Date(right.openedAt) - +new Date(left.openedAt)
  })
}

export function getWorkbenchVisibleTrades(options: {
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  display: DisplayPrefs
  search: string | URLSearchParams
}): Trade[] {
  const facets = parseTradeFacets(options.search)
  const trades = options.trades.filter((trade) => !trade.deletedAt)
  const routeFiltered = filterByListTarget(trades, options.filter, options.starredIds)
  const preferred = applyWorkbenchDisplayPrefs(
    routeFiltered,
    options.display,
    options.filter,
    facets.status,
  )
  return filterTradesByFacets(preferred, facets)
}
