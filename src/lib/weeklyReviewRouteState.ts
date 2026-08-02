export type WeeklyReviewTab = 'review' | 'year'

export type WeeklyReviewRouteState = {
  selectedWeek: string
  tab: WeeklyReviewTab
}

export type WeeklyReviewRouteOptions = {
  currentWeek: string
  availableWeeks: readonly string[]
}

export type WeeklyReviewRouteResolution = {
  state: WeeklyReviewRouteState
  canonicalSearch: string
  needsReplace: boolean
}

const OWNED_PARAMS = new Set(['week', 'tab'])

function unrelatedEntries(search: string): Array<[string, string]> {
  return [...new URLSearchParams(search).entries()]
    .filter(([key]) => !OWNED_PARAMS.has(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
}

function toSearch(params: URLSearchParams): string {
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function buildWeeklyReviewSearch(
  baseSearch: string,
  state: WeeklyReviewRouteState,
  currentWeek: string,
): string {
  const params = new URLSearchParams()
  if (state.selectedWeek !== currentWeek) params.set('week', state.selectedWeek)
  if (state.tab === 'year') params.set('tab', 'year')
  for (const [key, value] of unrelatedEntries(baseSearch)) params.append(key, value)
  return toSearch(params)
}

export function resolveWeeklyReviewRouteState(
  search: string,
  options: WeeklyReviewRouteOptions,
): WeeklyReviewRouteResolution {
  const params = new URLSearchParams(search)
  const requestedWeek = params.get('week')
  const selectedWeek = requestedWeek && options.availableWeeks.includes(requestedWeek)
    ? requestedWeek
    : options.currentWeek
  const tab: WeeklyReviewTab = params.get('tab') === 'year' ? 'year' : 'review'
  const state = { selectedWeek, tab }
  const canonicalSearch = buildWeeklyReviewSearch(search, state, options.currentWeek)
  return {
    state,
    canonicalSearch,
    needsReplace: canonicalSearch !== search,
  }
}
