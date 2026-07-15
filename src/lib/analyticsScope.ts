import type { Trade, TradeSide } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { resolveTradeTruth } from '@/lib/tradeTruth'

export type AnalyticsTradeKind = 'live' | 'paper' | 'all'
export type AnalyticsRange = 'all' | 'this-month' | '30d' | '90d' | 'ytd'

export interface AnalyticsScope {
  tradeKind?: AnalyticsTradeKind
  range?: AnalyticsRange
  strategyId?: string
  strategyVersionId?: string
  symbol?: string
  side?: TradeSide
  timeframe?: string
  session?: string
  tag?: string
  mistakeTag?: string
  currency?: string
}

export type AnalyticsExclusionReason =
  | 'deleted'
  | 'case'
  | 'tradeKind'
  | 'status'
  | 'scope'
  | 'missingClosedAt'
  | 'outsideRange'

export type AnalyticsExcludedCounts = Record<AnalyticsExclusionReason, number>

export interface AnalyticsCandidates {
  included: Trade[]
  temporalCandidates: Trade[]
  missingClosedAt: Trade[]
  excludedCounts: AnalyticsExcludedCounts
}

export interface AnalyticsUniverse extends AnalyticsCandidates {
  /** 可安全进入横截面 KPI 的结果。 */
  usable: Trade[]
  /** usable 中具有确定平仓日期、可进入顺序指标的结果。 */
  temporal: Trade[]
  conflicts: Trade[]
  missingResults: Trade[]
  /** usable 中缺少平仓日期、只能参与横截面统计的结果。 */
  usableMissingClosedAt: Trade[]
}

export interface AnalyticsSelectionOptions {
  /** YYYY-MM-DD date key supplied by the reporting context for deterministic ranges. */
  today?: string
}

type AnalyticsTradeFields = {
  closedAtTimestamp?: string | null
  strategyVersionId?: string | null
  pnlCurrency?: string | null
}

function emptyExcludedCounts(): AnalyticsExcludedCounts {
  return {
    deleted: 0,
    case: 0,
    tradeKind: 0,
    status: 0,
    scope: 0,
    missingClosedAt: 0,
    outsideRange: 0,
  }
}

function parseAnalyticsDateKey(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

function resolveClosedDateKey(trade: Trade): string | null {
  const analyticsFields = trade as Trade & AnalyticsTradeFields
  return parseAnalyticsDateKey(analyticsFields.closedAtTimestamp ?? trade.closedAt)
}

function matchesScopeDimensions(trade: Trade, scope: AnalyticsScope): boolean {
  const analyticsFields = trade as Trade & AnalyticsTradeFields
  if (scope.strategyId && trade.strategyId !== scope.strategyId) return false
  if (scope.strategyVersionId && analyticsFields.strategyVersionId !== scope.strategyVersionId) return false
  if (scope.symbol && trade.symbol !== scope.symbol) return false
  if (scope.side && trade.side !== scope.side) return false
  if (scope.timeframe && trade.timeframe !== scope.timeframe) return false
  if (scope.session && trade.session !== scope.session) return false
  if (scope.tag && !trade.tags.includes(scope.tag)) return false
  if (scope.mistakeTag && !trade.mistakeTags.includes(scope.mistakeTag)) return false
  if (scope.currency && analyticsFields.pnlCurrency !== scope.currency) return false
  return true
}

function formatLocalToday(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function resolveRangeBounds(
  range: Exclude<AnalyticsRange, 'all'>,
  today: string,
): { start: string; endExclusive: string } {
  if (range === 'this-month') {
    return {
      start: `${today.slice(0, 7)}-01`,
      endExclusive: addCalendarDays(today, 1),
    }
  }
  if (range === 'ytd') {
    return {
      start: `${today.slice(0, 4)}-01-01`,
      endExclusive: addCalendarDays(today, 1),
    }
  }
  return {
    start: addCalendarDays(today, range === '30d' ? -29 : -89),
    endExclusive: addCalendarDays(today, 1),
  }
}

/** Selects the stable, pre-evidence trade set shared by every analytics surface. */
export function selectAnalyticsCandidates(
  trades: readonly Trade[],
  scope: AnalyticsScope = {},
  options: AnalyticsSelectionOptions = {},
): AnalyticsCandidates {
  const included: Trade[] = []
  const temporalCandidates: Trade[] = []
  const missingClosedAt: Trade[] = []
  const excludedCounts = emptyExcludedCounts()
  const tradeKind = scope.tradeKind ?? 'live'
  const range = scope.range ?? 'all'
  const rangeBounds = (() => {
    if (range === 'all') return null
    const today = parseAnalyticsDateKey(options.today ?? formatLocalToday())
    if (!today) {
      throw new Error('AnalyticsSelectionOptions.today must be a valid YYYY-MM-DD date key')
    }
    return resolveRangeBounds(range, today)
  })()

  for (const trade of trades) {
    if (trade.deletedAt) {
      excludedCounts.deleted += 1
      continue
    }
    if (trade.tradeKind === 'case') {
      excludedCounts.case += 1
      continue
    }
    if (tradeKind !== 'all' && trade.tradeKind !== tradeKind) {
      excludedCounts.tradeKind += 1
      continue
    }
    if (!isExecutedClosed(trade.status)) {
      excludedCounts.status += 1
      continue
    }
    if (!matchesScopeDimensions(trade, scope)) {
      excludedCounts.scope += 1
      continue
    }

    const closedDateKey = resolveClosedDateKey(trade)
    if (!closedDateKey) {
      missingClosedAt.push(trade)
      if (rangeBounds) {
        excludedCounts.missingClosedAt += 1
        continue
      }
    } else if (
      rangeBounds &&
      (closedDateKey < rangeBounds.start || closedDateKey >= rangeBounds.endExclusive)
    ) {
      excludedCounts.outsideRange += 1
      continue
    }

    included.push(trade)
    if (closedDateKey) temporalCandidates.push(trade)
  }

  return { included, temporalCandidates, missingClosedAt, excludedCounts }
}

/** 在统一 scope 后只做一次证据分区，避免各统计入口自行解释“哪些交易可信”。 */
export function buildAnalyticsUniverse(
  trades: readonly Trade[],
  scope: AnalyticsScope = {},
  options: AnalyticsSelectionOptions = {},
): AnalyticsUniverse {
  const candidates = selectAnalyticsCandidates(trades, scope, options)
  const temporalIds = new Set(candidates.temporalCandidates.map((trade) => trade.id))
  const usable: Trade[] = []
  const temporal: Trade[] = []
  const conflicts: Trade[] = []
  const missingResults: Trade[] = []
  const usableMissingClosedAt: Trade[] = []

  for (const trade of candidates.included) {
    const truth = resolveTradeTruth(trade)
    if (truth.hasConflict) {
      conflicts.push(trade)
      continue
    }
    if (!truth.isResultComplete) {
      missingResults.push(trade)
      continue
    }
    usable.push(trade)
    if (temporalIds.has(trade.id)) temporal.push(trade)
    else usableMissingClosedAt.push(trade)
  }

  return {
    ...candidates,
    usable,
    temporal,
    conflicts,
    missingResults,
    usableMissingClosedAt,
  }
}
