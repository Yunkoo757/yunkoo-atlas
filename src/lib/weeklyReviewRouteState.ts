export type WeeklyReviewTab = 'review' | 'year'

export type WeeklyReviewRouteState = {
  selectedWeek: string
  tab: WeeklyReviewTab
}

export type WeeklyReviewRouteOptions = {
  currentWeek: string
  availableWeeks: readonly string[]
  verifiedReturnWeek?: string
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

function isMondayWeekStart(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day &&
    parsed.getDay() === 1
  )
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

export function buildWeeklyReviewReturnSearch(
  baseSearch: string,
  state: WeeklyReviewRouteState,
): string {
  const params = new URLSearchParams()
  params.set('week', state.selectedWeek)
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
  const selectedWeek = requestedWeek &&
    isMondayWeekStart(requestedWeek) &&
    (
      options.availableWeeks.includes(requestedWeek) ||
      options.verifiedReturnWeek === requestedWeek
    )
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
