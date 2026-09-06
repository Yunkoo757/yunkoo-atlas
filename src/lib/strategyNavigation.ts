/** Strategy navigation changes one filter only; user-selected scope stays intact. */
export function strategyNavigationSearch(strategyId: string, currentSearch: string): string {
  const params = new URLSearchParams({ strategyId })
  for (const [key, value] of new URLSearchParams(currentSearch)) {
    if (key !== 'strategyId') params.append(key, value)
  }
  return `?${params.toString()}`
}
