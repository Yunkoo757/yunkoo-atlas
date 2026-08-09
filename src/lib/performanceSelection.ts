import type { Trade } from '@/data/trades'
import type { AnalysisRange, AnalysisScope } from '@/lib/analysisScope'
import { writeAnalysisScope } from '@/lib/analysisScopeQuery'
import { formatYmd, getPeriodBounds, parseLocalDate, type BusinessDateAnchor } from '@/lib/periods'
import type { LiveArchiveScope } from '@/lib/liveStatisticsArchive'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { isAccountTrade } from '@/lib/tradeKind'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import { isValidLiveCycleDayKey } from '@/lib/liveCycle'

export const PERFORMANCE_REPORT_CURRENCY = 'USD'

type CurrencyTrade = Trade & { currency?: string | null }
const hasOwn = (value: object, property: string): boolean => Object.prototype.hasOwnProperty.call(value, property)

type CloseDayResolution =
  | { kind: 'valid', day: string }
  | { kind: 'missing' }
  | { kind: 'invalid' }

export type PerformanceSelectionInput = {
  scope: AnalysisScope
  liveScope: LiveArchiveScope | null
  anchor: BusinessDateAnchor
  legacyCashCurrencyAssumption: string | null
}

export type PerformanceSelection = {
  drilldownTarget: string
  futureCloseDayIds: string[]
  missingCloseDayIds: string[]
  invalidCloseDayIds: string[]
  completeResultIds: string[]
  conflictResultIds: string[]
  missingResultIds: string[]
  eligibleMetricIds: string[]
  pnlIds: string[]
  rIds: string[]
  unknownCurrencyIds: string[]
  currencyGroups: Array<{ currency: string, ids: string[] }>
}

function resolveCloseDay(trade: Trade, tradingDayStartHour: number): CloseDayResolution {
  // 已冻结字段是历史事实；无论是否有效，都不得再以 closedAt/openedAt 改写归属。
  if (trade.closedTradingDayKey !== undefined) {
    return isValidLiveCycleDayKey(trade.closedTradingDayKey)
      ? { kind: 'valid', day: trade.closedTradingDayKey }
      : { kind: 'invalid' }
  }
  if (trade.closedAt === null || trade.closedAt === undefined) return { kind: 'missing' }
  const day = closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour)
  return day === null ? { kind: 'invalid' } : { kind: 'valid', day }
}

function naturalRangeStart(range: AnalysisRange, anchor: BusinessDateAnchor): string | null {
  if (range === 'all') return null
  const today = parseLocalDate(anchor.currentTradingDayKey)
  if (range === 'this-week') return getPeriodBounds('this-week', anchor).start
  if (range === 'this-month') return formatYmd(new Date(today.getFullYear(), today.getMonth(), 1))
  if (range === 'ytd') return formatYmd(new Date(today.getFullYear(), 0, 1))
  const days = range === '30d' ? 30 : 90
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  return formatYmd(start)
}

function matchesKind(trade: Trade, scope: AnalysisScope): boolean {
  return scope.kind === 'all' || trade.tradeKind === scope.kind
}

function matchesLiveScope(trade: Trade, liveScope: LiveArchiveScope | null, day: string): boolean {
  if (trade.tradeKind !== 'live' || liveScope === null) return true
  if (liveScope.kind === 'pending') return false
  if (liveScope.kind === 'all-archives') {
    return liveScope.bounds?.startInclusive !== null
      && liveScope.bounds?.startInclusive !== undefined
      && day < liveScope.bounds.startInclusive
  }
  if (liveScope.bounds === null) return liveScope.kind === 'current'
  const { startInclusive, endExclusive } = liveScope.bounds
  return (startInclusive === null || day >= startInclusive)
    && (endExclusive === null || day < endExclusive)
}

function normalizedCurrency(trade: CurrencyTrade, fallback: string | null): string | null {
  const value = hasOwn(trade, 'currency') ? trade.currency : fallback
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized || null
}

export function buildPerformanceSelection(
  trades: readonly CurrencyTrade[],
  input: PerformanceSelectionInput,
): PerformanceSelection {
  const futureCloseDayIds: string[] = []
  const missingCloseDayIds: string[] = []
  const invalidCloseDayIds: string[] = []
  const completeResultIds: string[] = []
  const conflictResultIds: string[] = []
  const missingResultIds: string[] = []
  const eligibleMetricIds: string[] = []
  const pnlIds: string[] = []
  const rIds: string[] = []
  const unknownCurrencyIds: string[] = []
  const currencyGroups = new Map<string, string[]>()
  const naturalStart = naturalRangeStart(input.scope.range, input.anchor)

  for (const trade of trades) {
    if (trade.deletedAt || !isAccountTrade(trade) || !isExecutedClosed(trade.status)) continue
    const closeDay = resolveCloseDay(trade, input.anchor.tradingDayStartHour)
    if (closeDay.kind === 'missing') {
      missingCloseDayIds.push(trade.id)
      continue
    }
    if (closeDay.kind === 'invalid') {
      invalidCloseDayIds.push(trade.id)
      continue
    }
    if (closeDay.day > input.anchor.currentTradingDayKey) {
      futureCloseDayIds.push(trade.id)
      continue
    }
    if (!matchesKind(trade, input.scope)) continue
    if (!matchesLiveScope(trade, input.liveScope, closeDay.day)) continue
    if (naturalStart !== null && closeDay.day < naturalStart) continue

    const truth = resolveTradeTruth(trade)
    if (truth.hasConflict) {
      conflictResultIds.push(trade.id)
      continue
    }
    if (!truth.isResultComplete) {
      missingResultIds.push(trade.id)
      continue
    }

    completeResultIds.push(trade.id)
    eligibleMetricIds.push(trade.id)
    if (truth.hasR) rIds.push(trade.id)
    if (!truth.hasPnl) continue

    const currency = normalizedCurrency(trade, input.legacyCashCurrencyAssumption)
    if (currency === null) {
      unknownCurrencyIds.push(trade.id)
      continue
    }
    const group = currencyGroups.get(currency) ?? []
    group.push(trade.id)
    currencyGroups.set(currency, group)
    if (currency === PERFORMANCE_REPORT_CURRENCY) pnlIds.push(trade.id)
  }

  const query = writeAnalysisScope('', input.scope).toString()
  return {
    drilldownTarget: query ? `?${query}` : '',
    futureCloseDayIds,
    missingCloseDayIds,
    invalidCloseDayIds,
    completeResultIds,
    conflictResultIds,
    missingResultIds,
    eligibleMetricIds,
    pnlIds,
    rIds,
    unknownCurrencyIds,
    currencyGroups: [...currencyGroups].map(([currency, ids]) => ({ currency, ids })),
  }
}
