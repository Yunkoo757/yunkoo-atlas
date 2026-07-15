import type { TradeSide } from '@/data/trades'
import type {
  AnalyticsRange,
  AnalyticsScope,
  AnalyticsTradeKind,
} from '@/lib/analyticsScope'

export type DashboardQuality = 'all' | 'missing' | 'conflict' | 'confirmed' | 'verified'

export interface DashboardQuery {
  tradeKind: AnalyticsTradeKind
  range: AnalyticsRange
  quality: DashboardQuality
  scope: Omit<AnalyticsScope, 'tradeKind' | 'range'>
}

export type DashboardQueryKey =
  | 'kind'
  | 'range'
  | 'quality'
  | 'strategy'
  | 'strategyVersion'
  | 'symbol'
  | 'side'
  | 'timeframe'
  | 'session'
  | 'tag'
  | 'mistakeTag'
  | 'currency'

const TRADE_KINDS = new Set<AnalyticsTradeKind>(['live', 'paper', 'all'])
const RANGES = new Set<AnalyticsRange>(['all', 'this-month', '30d', '90d', 'ytd'])
const QUALITIES = new Set<DashboardQuality>(['all', 'missing', 'conflict', 'confirmed', 'verified'])
const SIDES = new Set<TradeSide>(['long', 'short'])

const DEFAULTS: Partial<Record<DashboardQueryKey, string>> = {
  kind: 'live',
  range: 'all',
  quality: 'all',
}

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim()
  return value ? value : undefined
}

export function parseDashboardQuery(input: string | URLSearchParams): DashboardQuery {
  const params = typeof input === 'string'
    ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
    : input
  const kind = params.get('kind') as AnalyticsTradeKind | null
  const range = params.get('range') as AnalyticsRange | null
  const quality = params.get('quality') as DashboardQuality | null
  const side = params.get('side') as TradeSide | null

  return {
    tradeKind: kind && TRADE_KINDS.has(kind) ? kind : 'live',
    range: range && RANGES.has(range) ? range : 'all',
    quality: quality && QUALITIES.has(quality) ? quality : 'all',
    scope: {
      strategyId: optionalParam(params, 'strategy'),
      strategyVersionId: optionalParam(params, 'strategyVersion'),
      symbol: optionalParam(params, 'symbol'),
      side: side && SIDES.has(side) ? side : undefined,
      timeframe: optionalParam(params, 'timeframe'),
      session: optionalParam(params, 'session'),
      tag: optionalParam(params, 'tag'),
      mistakeTag: optionalParam(params, 'mistakeTag'),
      currency: optionalParam(params, 'currency'),
    },
  }
}

export function updateDashboardQuery(
  current: string | URLSearchParams,
  key: DashboardQueryKey,
  value: string | null | undefined,
): URLSearchParams {
  const next = new URLSearchParams(
    typeof current === 'string' && current.startsWith('?') ? current.slice(1) : current,
  )
  const normalized = value?.trim() ?? ''
  if (!normalized || DEFAULTS[key] === normalized) next.delete(key)
  else next.set(key, normalized)
  if (key === 'strategy') next.delete('strategyVersion')
  return next
}

export function countDashboardDimensionFilters(query: DashboardQuery): number {
  return Object.values(query.scope).filter(Boolean).length
}
