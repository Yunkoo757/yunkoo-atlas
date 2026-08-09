import type { AnalysisScope } from '@/lib/analysisScope'

export function writeAnalysisScope(
  input: string | URLSearchParams,
  scope: AnalysisScope,
): URLSearchParams {
  const params = new URLSearchParams(input)
  params.set('kind', scope.kind)
  params.set('range', scope.range)
  return params
}
