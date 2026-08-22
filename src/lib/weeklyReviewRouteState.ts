export type WeeklyReviewTab = 'review' | 'year'

export type WeeklyReviewRouteState = {
  selectedWeek: string
  selectedReviewId?: string
  tab: WeeklyReviewTab
}

export type WeeklyReviewRouteReview = {
  id: string
  weekStart: string
  liveStageId?: string | null
}

export type WeeklyReviewRouteOptions = {
  currentWeek: string
  availableWeeks: readonly string[]
  availableReviews?: readonly WeeklyReviewRouteReview[]
  currentLiveStageId?: string
  verifiedReturnWeek?: string
  verifiedReturnReviewId?: string
}

export type WeeklyReviewRouteResolution = {
  state: WeeklyReviewRouteState
  canonicalSearch: string
  needsReplace: boolean
}

const OWNED_PARAMS = new Set(['week', 'review', 'tab'])

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
  if (state.selectedReviewId) params.set('review', state.selectedReviewId)
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
  if (state.selectedReviewId) params.set('review', state.selectedReviewId)
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
  const availableReviews = (options.availableReviews ?? []).filter(
    (review) => typeof review.liveStageId === 'string',
  )
  const hasRequestedReviewParam = params.has('review')
  const requestedReviewId = params.get('review')
  const requestedReview = requestedReviewId
    ? availableReviews.find((review) => review.id === requestedReviewId)
    : undefined
  const invalidRequestedReview = hasRequestedReviewParam && !requestedReview
  const acceptedRequestedWeek = requestedWeek &&
    isMondayWeekStart(requestedWeek) &&
    (
      options.availableWeeks.includes(requestedWeek) ||
      options.verifiedReturnWeek === requestedWeek
    )
    ? requestedWeek
    : undefined
  const selectedWeek = requestedReview
    ? requestedReview.weekStart
    : invalidRequestedReview
      ? options.currentWeek
      : acceptedRequestedWeek ?? options.currentWeek
  const selectedReview = requestedReview ?? (
    !acceptedRequestedWeek || hasRequestedReviewParam
      ? undefined
      : availableReviews.find((review) =>
          review.weekStart === selectedWeek && review.liveStageId === options.currentLiveStageId,
        ) ?? availableReviews.find((review) => review.weekStart === selectedWeek)
  )
  const tab: WeeklyReviewTab = params.get('tab') === 'year' ? 'year' : 'review'
  const selectedReviewId = selectedReview?.id
  const state = { selectedWeek, ...(selectedReviewId ? { selectedReviewId } : {}), tab }
  const canonicalSearch = buildWeeklyReviewSearch(search, state, options.currentWeek)
  return {
    state,
    canonicalSearch,
    needsReplace: canonicalSearch !== search,
  }
}
