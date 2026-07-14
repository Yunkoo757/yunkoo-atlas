import type { ReviewCategory, Trade, TradeSide, TradeStatus } from '@/data/trades'
import { isAccountTrade } from '@/lib/tradeKind'
import type { DisplayPrefs, ListFilter } from '@/lib/tradeFilters'
import { CALENDAR_PERIODS, tradeInPeriod, type CalendarPeriod } from '@/lib/periods'
import { isActive, isHiddenWhenClosedFilter, isMissed, STATUS_ORDER } from '@/lib/tradeStatus'
import {
  filterTradesByFacets,
  matchesTradeFacets,
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

export function filterTrades(
  trades: Trade[],
  filter: ListFilter,
  starredIds: string[],
): Trade[] {
  const starred = new Set(starredIds)
  return trades.filter((trade) => matchesListFilter(trade, filter, starred))
}

function matchesListFilter(
  trade: Trade,
  filter: ListFilter,
  starredIds: ReadonlySet<string>,
): boolean {
  switch (filter.type) {
    case 'active':
      if (!isActive(trade.status)) return false
      break
    case 'starred':
      if (!starredIds.has(trade.id)) return false
      break
    case 'strategy':
      if (filter.strategyId && trade.strategyId !== filter.strategyId) return false
      break
    case 'missed':
      if (!isMissed(trade.status)) return false
      break
    case 'period':
      if (filter.period && !tradeInPeriod(trade, filter.period)) return false
      break
    default:
      break
  }

  if (filter.tradeKind ? trade.tradeKind !== filter.tradeKind : !isAccountTrade(trade)) return false

  if (filter.tradeKind !== 'case' || !filter.reviewCaseScope || filter.reviewCaseScope === 'all') {
    return true
  }
  if (filter.reviewCaseScope === 'focus') {
    return (
      starredIds.has(trade.id) ||
      trade.reviewCategory === 'focus' ||
      trade.reviewStatus === 'focus'
    )
  }
  if (filter.reviewCaseScope === 'mistakes') {
    return (
      trade.caseType === 'mistake' ||
      trade.reviewCategory === 'mistake' ||
      trade.mistakeTags.length > 0
    )
  }
  if (filter.reviewCaseScope === 'unreviewed') {
    return (
      trade.masteryState === 'new' ||
      trade.masteryState === 'recheck' ||
      trade.reviewCategory === 'recheck' ||
      trade.reviewStatus === 'unreviewed'
    )
  }
  if (filter.reviewCaseScope === 'reviewed') {
    return (
      trade.masteryState === 'mastered' ||
      trade.reviewCategory === 'mastered' ||
      trade.reviewStatus === 'reviewed'
    )
  }
  return true
}

export function applyDisplayPrefs(
  trades: Trade[],
  prefs: DisplayPrefs,
  filter?: ListFilter,
): Trade[] {
  // 错过机会页要看终态；案例记录是复盘样本，不受「隐藏已平仓」影响
  const skipHideClosed = filter?.type === 'missed' || filter?.tradeKind === 'case'
  const visible = prefs.hideClosed && !skipHideClosed
    ? trades.filter((trade) => !isHiddenWhenClosedFilter(trade.status))
    : [...trades]
  return visible.sort((left, right) => {
    if (prefs.sortBy === 'pnl') return compareOptionalDesc(left.pnl, right.pnl)
    if (prefs.sortBy === 'conviction') {
      return CONVICTION_RANK[right.conviction] - CONVICTION_RANK[left.conviction]
    }
    return +new Date(right.openedAt) - +new Date(left.openedAt)
  })
}

function compareOptionalDesc(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return right - left
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
  const routeFiltered = filterTrades(trades, options.filter, options.starredIds)
  // 用户显式筛选已平仓状态时，不能再被「隐藏已平仓」吃掉。
  const prefs = facets.status && isHiddenWhenClosedFilter(facets.status)
    ? { ...options.display, hideClosed: false }
    : options.display
  const preferred = applyDisplayPrefs(routeFiltered, prefs, options.filter)
  return filterTradesByFacets(preferred, facets)
}

export function countWorkbenchVisibleTrades(options: {
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  display: DisplayPrefs
  search: string | URLSearchParams
}): number {
  const facets = parseTradeFacets(options.search)
  const starred = new Set(options.starredIds)
  const skipHideClosed = options.filter.type === 'missed' || options.filter.tradeKind === 'case'
  const hideClosed = options.display.hideClosed && !skipHideClosed && !(
    facets.status && isHiddenWhenClosedFilter(facets.status)
  )
  let count = 0
  for (const trade of options.trades) {
    if (trade.deletedAt) continue
    if (!matchesListFilter(trade, options.filter, starred)) continue
    if (hideClosed && isHiddenWhenClosedFilter(trade.status)) continue
    if (!matchesTradeFacets(trade, facets)) continue
    count += 1
  }
  return count
}
