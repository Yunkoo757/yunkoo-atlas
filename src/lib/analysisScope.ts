import type { Trade } from '@/data/trades'
import {
  createBusinessDateAnchor,
  DEFAULT_TRADING_DAY_START_HOUR,
  type BusinessDateAnchor,
} from '@/lib/periods'
import {
  buildPerformanceSelection,
  type PerformanceDateBounds,
} from '@/lib/performanceSelection'
import { writeAnalysisScope } from '@/lib/analysisScopeQuery'
import { filterStageOwnedRecords, type StageScope } from '@/lib/stageArchive'

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

export function parseAnalysisKind(value: string | null): AnalysisKind | null {
  return ANALYSIS_KINDS.find(kind => kind === value) ?? null
}

export function parseAnalysisRange(value: string | null): AnalysisRange | null {
  return ANALYSIS_RANGES.find(range => range === value) ?? null
}

export function parseAnalysisScope(
  input: string | URLSearchParams,
): ParsedAnalysisScope {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const kind = parseAnalysisKind(params.get('kind'))
  const range = parseAnalysisRange(params.get('range'))
  return {
    scope: { kind: kind ?? DEFAULT_ANALYSIS_SCOPE.kind, range: range ?? DEFAULT_ANALYSIS_SCOPE.range },
    explicit: kind !== null || range !== null,
  }
}

export function filterTradesByAnalysisScope(
  trades: readonly Trade[],
  scope: AnalysisScope,
  now: Date | BusinessDateAnchor = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  performanceBounds: PerformanceDateBounds | null = null,
  stageScope?: StageScope,
): Trade[] {
  const anchor = now instanceof Date
    ? createBusinessDateAnchor(now, tradingDayStartHour)
    : now
  const stageTrades = stageScope ? filterStageOwnedRecords(trades, stageScope) : trades
  const eligibleIds = new Set(buildPerformanceSelection(stageTrades, {
    scope,
    dateBounds: performanceBounds,
    anchor,
    legacyCashCurrencyAssumption: null,
  }).eligibleMetricIds)
  return stageTrades.filter((trade) => eligibleIds.has(trade.id))
}

export function strategyAnalysisHref(
  strategyId: string,
  scope: AnalysisScope,
  liveStage?: string,
): string {
  const params = new URLSearchParams()
  params.set('kind', scope.kind)
  params.set('range', scope.range)
  if (liveStage) params.set('liveStage', liveStage)
  return `/strategy/${encodeURIComponent(strategyId)}?${params.toString()}`
}
