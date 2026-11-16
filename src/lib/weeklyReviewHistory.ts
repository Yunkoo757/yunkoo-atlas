import type { Trade } from '@/data/trades'
import { createWeeklyReview, deriveWeeklyReviewWeeks, type WeeklyReview } from '@/data/weeklyReviews'

export type WeeklyReviewHistoryItem = {
  key: string
  routeId: string
  week: string
  liveStageId: string
  review?: WeeklyReview
}

/** Read-only history projection: pending rows have a stable route, never a stored record. */
export function buildWeeklyReviewHistory({ trades, reviews, stageIds, selectedStageId, currentWeek, tradingDayStartHour, currentTradingDayKey, allStages }: {
  trades: Trade[]
  reviews: WeeklyReview[]
  stageIds: string[]
  selectedStageId: string
  currentWeek: string
  tradingDayStartHour: number
  currentTradingDayKey: string
  allStages: boolean
}): WeeklyReviewHistoryItem[] {
  const items = new Map<string, WeeklyReviewHistoryItem>()
  const assigned = reviews.filter((review) => typeof review.liveStageId === 'string')
  for (const stageId of allStages ? stageIds : [selectedStageId]) {
    const weeks = deriveWeeklyReviewWeeks(
      trades.filter((trade) => trade.tradeKind === 'live' && trade.liveStageId === stageId),
      [], currentWeek, tradingDayStartHour, 12, currentTradingDayKey,
      { includeCurrentWeek: stageId === selectedStageId },
    )
    for (const week of weeks) {
      const routeId = createWeeklyReview(week, stageId).id
      items.set(`${stageId}:${week}`, { key: routeId, routeId, week, liveStageId: stageId })
    }
  }
  // Saved history remains reachable when opening another stage's detail.
  for (const review of assigned) {
    const liveStageId = review.liveStageId!
    items.set(`${liveStageId}:${review.weekStart}`, { key: review.id, routeId: review.id, week: review.weekStart, liveStageId, review })
  }
  return [...items.values()].sort((left, right) =>
    right.week.localeCompare(left.week) ||
    Number(right.liveStageId === selectedStageId) - Number(left.liveStageId === selectedStageId) ||
    left.routeId.localeCompare(right.routeId),
  )
}
