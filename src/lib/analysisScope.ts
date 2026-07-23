import type { Trade } from '@/data/trades'
import {
  createBusinessDateAnchor,
  formatYmd,
  getPeriodBounds,
  isDateInRange,
  parseLocalDate,
  type BusinessDateAnchor,
} from '@/lib/periods'
import { isAccountTrade } from '@/lib/tradeKind'
import { isExecutedClosed } from '@/lib/tradeStatus'

export type AnalysisKind = 'live' | 'paper' | 'all'
export type AnalysisRange = 'all' | 'this-week' | 'this-month' | '30d' | '90d' | 'ytd'

export interface AnalysisScope {
  kind: AnalysisKind
  range: AnalysisRange
}

export interface ParsedAnalysisScope {
  scope: AnalysisScope
  explicit: boolean
}

export const DEFAULT_ANALYSIS_SCOPE: AnalysisScope = {
  kind: 'live',
  range: 'all',
}

const ANALYSIS_KINDS: AnalysisKind[] = ['live', 'paper', 'all']
const ANALYSIS_RANGES: AnalysisRange[] = ['all', 'this-week', 'this-month', '30d', '90d', 'ytd']

export function parseAnalysisScope(
  input: string | URLSearchParams,
): ParsedAnalysisScope {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const rawKind = params.get('kind')
  const rawRange = params.get('range')
  const kind = ANALYSIS_KINDS.includes(rawKind as AnalysisKind)
    ? rawKind as AnalysisKind
    : DEFAULT_ANALYSIS_SCOPE.kind
  const range = ANALYSIS_RANGES.includes(rawRange as AnalysisRange)
    ? rawRange as AnalysisRange
    : DEFAULT_ANALYSIS_SCOPE.range
  return {
    scope: { kind, range },
    explicit:
      ANALYSIS_KINDS.includes(rawKind as AnalysisKind) ||
      ANALYSIS_RANGES.includes(rawRange as AnalysisRange),
  }
}

export function filterTradesByAnalysisScope(
  trades: readonly Trade[],
  scope: AnalysisScope,
  now: Date | BusinessDateAnchor = new Date(),
  tradingDayStartHour?: number,
): Trade[] {
  const scoped = trades.filter((trade) =>
    !trade.deletedAt &&
    isAccountTrade(trade) &&
    isExecutedClosed(trade.status) &&
    (scope.kind === 'all' || trade.tradeKind === scope.kind),
  )
  if (scope.range === 'all') return scoped

  const anchor = now instanceof Date
    ? createBusinessDateAnchor(now, tradingDayStartHour)
    : now
  const end = parseLocalDate(anchor.currentTradingDayKey)
  const today = anchor.currentTradingDayKey
  let bounds: { start: string; end: string }

  if (scope.range === 'this-week') {
    // 与本月一致：周一起点到今天（不含未来周日）
    bounds = { start: getPeriodBounds('this-week', anchor).start, end: today }
  } else if (scope.range === 'this-month') {
    bounds = {
      start: formatYmd(new Date(end.getFullYear(), end.getMonth(), 1)),
      end: today,
    }
  } else if (scope.range === 'ytd') {
    bounds = {
      start: formatYmd(new Date(end.getFullYear(), 0, 1)),
      end: today,
    }
  } else {
    const dayCount = scope.range === '30d' ? 30 : scope.range === '90d' ? 90 : null
    if (dayCount === null) return scoped
    const start = new Date(end)
    start.setDate(start.getDate() - (dayCount - 1))
    bounds = { start: formatYmd(start), end: today }
  }

  return scoped.filter((trade) => isDateInRange(trade.closedAt ?? trade.openedAt, bounds))
}

export function writeAnalysisScope(
  input: string | URLSearchParams,
  scope: AnalysisScope,
): URLSearchParams {
  const params = new URLSearchParams(input)
  params.set('kind', scope.kind)
  params.set('range', scope.range)
  return params
}

export function strategyAnalysisHref(
  strategyId: string,
  scope: AnalysisScope,
): string {
  const params = new URLSearchParams()
  params.set('kind', scope.kind)
  params.set('range', scope.range)
  return `/strategy/${encodeURIComponent(strategyId)}?${params.toString()}`
}
