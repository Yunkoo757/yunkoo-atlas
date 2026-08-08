import type { AnalysisKind } from '@/lib/analysisScope'
import { resolveLiveArchiveScope, type LiveArchiveScope } from '@/lib/liveStatisticsArchive'
import {
  LIVE_PERFORMANCE_CYCLE_RESERVED_IDS,
  resolveLivePerformanceCycle,
  type LivePerformanceCycle,
  type ResolvedLivePerformanceCycle,
} from '@/lib/livePerformanceCycles'

export type LivePerformanceCycleRouteState = {
  resolved: ResolvedLivePerformanceCycle
  canonicalSearch: string
  needsReplace: boolean
}

export type TradeListPerformanceCycleRouteState = {
  resolved: ResolvedLivePerformanceCycle | null
  canonicalSearch: string
  needsReplace: boolean
}

export type LiveRouteTarget =
  | { kind: 'current'; scope: LiveArchiveScope }
  | { kind: 'archive'; scope: LiveArchiveScope }
  | { kind: 'pending'; scope: LiveArchiveScope }
  | { kind: 'archive-home'; reason: 'all' | 'pre-cycle' | 'missing'; requestedKey: string | null }

export type LiveRouteState = {
  target: LiveRouteTarget
  canonicalSearch: string
  needsReplace: boolean
}

function copyParams(input: string | URLSearchParams): URLSearchParams {
  return new URLSearchParams(input)
}

function searchFor(params: URLSearchParams): string {
  const query = params.toString()
  return query ? `?${query}` : ''
}

function removeRiskCycle(params: URLSearchParams): void {
  params.delete('liveCycle')
}

/** Resolves every live-facing route through the archive kernel without making current explicit in URLs. */
export function resolveLiveRoute(
  input: string | URLSearchParams,
  cycles: readonly LivePerformanceCycle[],
  _context: 'dashboard' | 'trade-list' | 'strategy' | 'archive',
): LiveRouteState {
  const params = copyParams(input)
  const originalSearch = searchFor(params)
  const raw = params.get('statsCycle')
  const requested = raw?.trim() ?? null
  removeRiskCycle(params)

  if (requested === null || requested === '' || requested === 'current') {
    params.delete('statsCycle')
    return {
      target: { kind: 'current', scope: resolveLiveArchiveScope(cycles, null) },
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }
  if (requested === 'all' || requested === 'pre-cycle') {
    if (raw !== requested) params.set('statsCycle', requested)
    return {
      target: { kind: 'archive-home', reason: requested, requestedKey: requested },
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }
  if (requested === 'pending') {
    return {
      target: { kind: 'pending', scope: resolveLiveArchiveScope(cycles, 'pending') },
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }
  const scope = resolveLiveArchiveScope(cycles, requested)
  if (scope.missingRequestedKey) {
    if (raw !== requested) params.set('statsCycle', requested)
    return {
      target: { kind: 'archive-home', reason: 'missing', requestedKey: requested },
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }
  if (scope.kind === 'current') {
    params.delete('statsCycle')
    return { target: { kind: 'current', scope }, canonicalSearch: searchFor(params), needsReplace: searchFor(params) !== originalSearch }
  }
  return { target: { kind: 'archive', scope }, canonicalSearch: searchFor(params), needsReplace: searchFor(params) !== originalSearch }
}

export function resolvePerformanceAnalysisRoute(
  input: string | URLSearchParams,
  kind: AnalysisKind,
  cycles: readonly LivePerformanceCycle[],
): LivePerformanceCycleRouteState {
  const params = copyParams(input)
  const originalSearch = searchFor(params)
  removeRiskCycle(params)

  if (kind !== 'live') {
    params.delete('statsCycle')
    return {
      resolved: resolveLivePerformanceCycle(cycles, 'all'),
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }

  const resolved = resolveLivePerformanceCycle(cycles, params.get('statsCycle'))
  if (cycles.length === 0 || resolved.isCurrent) params.delete('statsCycle')

  return {
    resolved,
    canonicalSearch: searchFor(params),
    needsReplace: searchFor(params) !== originalSearch,
  }
}

export function writePerformanceAnalysisCycle(
  input: string | URLSearchParams,
  selected: 'current' | 'pre-cycle' | 'all' | string,
  cycles: readonly LivePerformanceCycle[],
): URLSearchParams {
  const params = copyParams(input)
  removeRiskCycle(params)
  params.set('range', 'all')

  const resolved = resolveLivePerformanceCycle(cycles, selected === 'current' ? null : selected)
  if (cycles.length === 0 || resolved.isCurrent) params.delete('statsCycle')
  else if (resolved.key === LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.all) {
    params.set('statsCycle', LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.all)
  } else if (resolved.key === LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.preCycle) {
    params.set('statsCycle', LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.preCycle)
  }
  else params.set('statsCycle', resolved.cycleId!)
  return params
}

export function writeTradeListPerformanceCycle(
  input: string | URLSearchParams,
  cycleId: string | 'pre-cycle' | null,
): URLSearchParams {
  const params = copyParams(input)
  removeRiskCycle(params)
  if (cycleId === null) params.delete('statsCycle')
  else params.set('statsCycle', cycleId)
  return params
}

/**
 * 交易列表把缺省值解释为“不筛选”，因此不能复用分析页的 current 回退语义。
 * 只有仍存在的显式真实 ID（或虚拟的起点前）才会解析出周期；失效 ID 只清除自身。
 */
export function resolveTradeListPerformanceCycleRoute(
  input: string | URLSearchParams,
  cycles: readonly LivePerformanceCycle[],
  enabled: boolean,
): TradeListPerformanceCycleRouteState {
  const params = copyParams(input)
  const originalSearch = searchFor(params)
  const requested = params.get('statsCycle')?.trim() ?? ''
  if (!requested) {
    params.delete('statsCycle')
    return {
      resolved: null,
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }

  // 外部 URL 同时给出两种周期时，显式绩效周期拥有优先权；即便 ID 已失效也不回落到风险筛选。
  removeRiskCycle(params)
  const valid = enabled && (
    (requested === LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.preCycle && cycles.length > 0) ||
    cycles.some((cycle) => cycle.id === requested)
  )
  if (!valid) {
    params.delete('statsCycle')
    return {
      resolved: null,
      canonicalSearch: searchFor(params),
      needsReplace: searchFor(params) !== originalSearch,
    }
  }

  params.set('statsCycle', requested)
  return {
    resolved: resolveLivePerformanceCycle(cycles, requested),
    canonicalSearch: searchFor(params),
    needsReplace: searchFor(params) !== originalSearch,
  }
}
