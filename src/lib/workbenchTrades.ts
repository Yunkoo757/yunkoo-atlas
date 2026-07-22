import type {
  CaseType,
  MasteryState,
  ReviewCategory,
  Trade,
  TradeSide,
  TradeStatus,
} from '@/data/trades'
import { isAccountTrade } from '@/lib/tradeKind'
import { filterTradesByAnalysisScope } from '@/lib/analysisScope'
import type { DisplayPrefs, ListFilter } from '@/lib/tradeFilters'
import { CALENDAR_PERIODS, DEFAULT_TRADING_DAY_START_HOUR, tradeInPeriod, type CalendarPeriod } from '@/lib/periods'
import { isActive, isHiddenWhenClosedFilter, isMissed, STATUS_ORDER } from '@/lib/tradeStatus'
import { matchesReviewCaseScope } from '@/lib/reviewCaseScope'
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

const CASE_TYPES: CaseType[] = ['exemplar', 'mistake', 'ambiguous', 'missed']
const MASTERY_STATES: MasteryState[] = ['new', 'recheck', 'mastered']

const CONVICTION_RANK: Record<Trade['conviction'], number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function parseTradeFacets(search: string | URLSearchParams): TradeFacetFilters {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const tradeKind = params.get('tradeKind')
  const side = params.get('side')
  const status = params.get('status')
  const reviewCategory = params.get('reviewCategory')
  const caseType = params.get('caseType')
  const masteryState = params.get('masteryState')
  const session = params.get('session')
  const period = params.get('period')
  return {
    tradeKind: tradeKind === 'live' || tradeKind === 'paper' ? tradeKind : undefined,
    symbol: params.get('symbol') || undefined,
    side: side === 'long' || side === 'short' ? (side as TradeSide) : undefined,
    status: STATUS_ORDER.includes(status as TradeStatus) ? (status as TradeStatus) : undefined,
    tag: params.get('tag') || undefined,
    mistakeTag: params.get('mistakeTag') || undefined,
    reviewCategory: REVIEW_CATEGORIES.includes(reviewCategory as ReviewCategory)
      ? (reviewCategory as ReviewCategory)
      : undefined,
    caseType: CASE_TYPES.includes(caseType as CaseType)
      ? (caseType as CaseType)
      : undefined,
    masteryState: MASTERY_STATES.includes(masteryState as MasteryState)
      ? (masteryState as MasteryState)
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

/** 将 facet 写成稳定顺序的查询字符串，供保存视图与路由往返测试共用。 */
export function serializeTradeFacets(facets: TradeFacetFilters): string {
  const params = new URLSearchParams()
  const entries: Array<[string, string | undefined]> = [
    ['tradeKind', facets.tradeKind],
    ['symbol', facets.symbol],
    ['side', facets.side],
    ['status', facets.status],
    ['tag', facets.tag],
    ['mistakeTag', facets.mistakeTag],
    ['reviewCategory', facets.reviewCategory],
    ['caseType', facets.caseType],
    ['masteryState', facets.masteryState],
    ['session', facets.session],
    ['period', facets.period],
    ['strategyId', facets.strategyId],
  ]
  for (const [key, value] of entries) {
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function filterTrades(
  trades: Trade[],
  filter: ListFilter,
  starredIds: string[],
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): Trade[] {
  const starred = new Set(starredIds)
  return trades.filter((trade) =>
    matchesListFilter(trade, filter, starred, tradingDayStartHour),
  )
}

function matchesListFilter(
  trade: Trade,
  filter: ListFilter,
  starredIds: ReadonlySet<string>,
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
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
      if (filter.period && !tradeInPeriod(trade, filter.period, 'openedAt', new Date(), tradingDayStartHour)) {
        return false
      }
      break
    default:
      break
  }

  // 三域隔离：交易日志系统视图未显式声明时默认实盘；案例 / 模拟必须自带 tradeKind。
  const scopedKind =
    filter.tradeKind ??
    (filter.type === 'starred' || filter.type === 'missed' || filter.type === 'active'
      ? 'live'
      : undefined)
  if (scopedKind) {
    if (trade.tradeKind !== scopedKind) return false
  } else if (!isAccountTrade(trade)) {
    return false
  }

  if (filter.tradeKind === 'case') {
    return matchesReviewCaseScope(trade, filter.reviewCaseScope, starredIds)
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

type WorkbenchTradeDerivationOptions = {
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  display: DisplayPrefs
  search: string | URLSearchParams
}

export function deriveWorkbenchVisibleTrades(
  options: WorkbenchTradeDerivationOptions,
): { trades: Trade[]; visible: Trade[] } {
  const parsedFacets = parseTradeFacets(options.search)
  const facets = options.filter.tradeKind || (
    options.filter.analysisScope && options.filter.analysisScope.kind !== 'all'
  )
    ? { ...parsedFacets, tradeKind: undefined }
    : parsedFacets
  const trades = options.trades.filter((trade) => !trade.deletedAt)
  const tradingDayStartHour =
    options.display.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR
  const routeFiltered = filterTrades(
    trades,
    options.filter,
    options.starredIds,
    tradingDayStartHour,
  )
  const analysisFiltered = options.filter.analysisScope
    ? filterTradesByAnalysisScope(routeFiltered, options.filter.analysisScope)
    : routeFiltered
  // 用户显式筛选已平仓状态时，不能再被「隐藏已平仓」吃掉。
  const prefs = options.filter.analysisScope || (facets.status && isHiddenWhenClosedFilter(facets.status))
    ? { ...options.display, hideClosed: false }
    : options.display
  const preferred = applyDisplayPrefs(analysisFiltered, prefs, options.filter)
  return {
    trades,
    visible: filterTradesByFacets(preferred, facets, tradingDayStartHour),
  }
}

export function getWorkbenchVisibleTrades(options: WorkbenchTradeDerivationOptions): Trade[] {
  return deriveWorkbenchVisibleTrades(options).visible
}

export function countWorkbenchVisibleTrades(options: {
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  display: DisplayPrefs
  search: string | URLSearchParams
}): number {
  const parsedFacets = parseTradeFacets(options.search)
  const facets = options.filter.tradeKind || (
    options.filter.analysisScope && options.filter.analysisScope.kind !== 'all'
  )
    ? { ...parsedFacets, tradeKind: undefined }
    : parsedFacets
  const tradingDayStartHour =
    options.display.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR
  const starred = new Set(options.starredIds)
  const skipHideClosed = options.filter.type === 'missed' || options.filter.tradeKind === 'case'
  const hideClosed = options.display.hideClosed && !skipHideClosed && !options.filter.analysisScope && !(
    facets.status && isHiddenWhenClosedFilter(facets.status)
  )
  const sourceTrades = options.filter.analysisScope
    ? filterTradesByAnalysisScope(options.trades, options.filter.analysisScope)
    : options.trades
  let count = 0
  for (const trade of sourceTrades) {
    if (trade.deletedAt) continue
    if (!matchesListFilter(trade, options.filter, starred, tradingDayStartHour)) continue
    if (hideClosed && isHiddenWhenClosedFilter(trade.status)) continue
    if (!matchesTradeFacets(trade, facets, tradingDayStartHour)) continue
    count += 1
  }
  return count
}
