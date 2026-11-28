import type { WeeklyReview } from './weeklyReviews'

export const WEEKLY_TRADE_MARK_FIELDS = ['highlightTradeIds', 'mistakeTradeIds', 'followUpTradeIds'] as const

export function weeklyReviewMarkedTradeIds(review: WeeklyReview): Set<string> {
  return new Set(WEEKLY_TRADE_MARK_FIELDS.flatMap(field => review[field]))
}

/** 本周保存的交易证据。上周承诺的链接可独立留存，不参与本周的阶段归属。 */
export function weeklyReviewFrozenTradeIds(review: WeeklyReview): Set<string> {
  const ids = new Set<string>()
  for (const trade of review.evidenceSnapshot?.trades ?? []) ids.add(trade.id)
  for (const trade of review.evidenceSnapshot?.missedTrades ?? []) ids.add(trade.id)
  for (const event of review.riskSnapshot?.overrideEvents ?? []) ids.add(event.tradeId)
  return ids
}

/** 标记指向现存交易；同一编号还具备冻结证据时，来源删除后仍可回读。 */
export function weeklyReviewTradeReferences(review: WeeklyReview) {
  const references = new Map<string, 'marked' | 'frozen'>()
  for (const id of weeklyReviewMarkedTradeIds(review)) references.set(id, 'marked')
  for (const id of weeklyReviewFrozenTradeIds(review)) references.set(id, 'frozen')
  return references
}

export function updateWeeklyReviewMarks(review: WeeklyReview, transform: (ids: string[]) => string[]): WeeklyReview {
  let updated = review
  for (const field of WEEKLY_TRADE_MARK_FIELDS) {
    const ids = review[field]
    const next = transform(ids)
    if (next.length === ids.length && next.every((id, index) => id === ids[index])) continue
    if (updated === review) updated = { ...review }
    updated[field] = next
  }
  return updated
}
