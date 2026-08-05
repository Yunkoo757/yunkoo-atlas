import type { AnalysisKind } from '@/lib/analysisScope'
import {
  resolveLivePerformanceCycle,
  type LivePerformanceCycle,
  type ResolvedLivePerformanceCycle,
} from '@/lib/livePerformanceCycles'

export type LivePerformanceCycleRouteState = {
  resolved: ResolvedLivePerformanceCycle
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
  if (resolved.isCurrent) params.delete('statsCycle')

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
  if (resolved.isCurrent) params.delete('statsCycle')
  else if (resolved.key === 'all') params.set('statsCycle', 'all')
  else if (resolved.key === 'pre-cycle') params.set('statsCycle', 'pre-cycle')
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
