import type { Trade } from '@/data/trades'
import {
  createBusinessDateAnchor,
  formatYmd,
  getPeriodBounds,
  parseLocalDate,
  DEFAULT_TRADING_DAY_START_HOUR,
  type BusinessDateAnchor,
} from '@/lib/periods'
import type { LivePerformanceCycleBounds } from '@/lib/livePerformanceCycles'
import type { LiveArchiveScope } from '@/lib/liveStatisticsArchive'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { writeAnalysisScope } from '@/lib/analysisScopeQuery'

export { writeAnalysisScope } from '@/lib/analysisScopeQuery'

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
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  performanceBounds: LivePerformanceCycleBounds | null = null,
): Trade[] {
  const anchor = now instanceof Date
    ? createBusinessDateAnchor(now, tradingDayStartHour)
    : now
  const liveScope: LiveArchiveScope | null = performanceBounds === null
    ? null
    : {
        kind: 'current',
        archiveId: null,
        bounds: performanceBounds,
        label: '当前实盘',
      }
  const eligibleIds = new Set(buildPerformanceSelection(trades, {
    scope,
    liveScope,
    anchor,
    legacyCashCurrencyAssumption: null,
  }).eligibleMetricIds)
  return trades.filter((trade) => eligibleIds.has(trade.id))
}

export function intersectLiveScopeWithNaturalRange(
  scope: LiveArchiveScope,
  range: AnalysisRange,
  anchor: BusinessDateAnchor,
): LivePerformanceCycleBounds | null {
  if (scope.bounds === null || range === 'all') return scope.bounds
  const end = parseLocalDate(anchor.currentTradingDayKey)
  const today = anchor.currentTradingDayKey
  let start: string
  if (range === 'this-week') start = getPeriodBounds('this-week', anchor).start
  else if (range === 'this-month') start = formatYmd(new Date(end.getFullYear(), end.getMonth(), 1))
  else if (range === 'ytd') start = formatYmd(new Date(end.getFullYear(), 0, 1))
  else {
    const count = range === '30d' ? 30 : range === '90d' ? 90 : 1
    const date = new Date(end)
    date.setDate(date.getDate() - (count - 1))
    start = formatYmd(date)
  }
  const tomorrow = new Date(end)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const endExclusive = formatYmd(tomorrow)
  const intersectedStart = scope.bounds.startInclusive && scope.bounds.startInclusive > start
    ? scope.bounds.startInclusive : start
  const intersectedEnd = scope.bounds.endExclusive && scope.bounds.endExclusive < endExclusive
    ? scope.bounds.endExclusive : endExclusive
  return intersectedStart >= intersectedEnd ? null : { startInclusive: intersectedStart, endExclusive: intersectedEnd }
}

export function strategyAnalysisHref(
  strategyId: string,
  scope: AnalysisScope,
  statsCycle?: string,
): string {
  const params = new URLSearchParams()
  params.set('kind', scope.kind)
  params.set('range', scope.range)
  if (statsCycle) params.set('statsCycle', statsCycle)
  return `/strategy/${encodeURIComponent(strategyId)}?${params.toString()}`
}
