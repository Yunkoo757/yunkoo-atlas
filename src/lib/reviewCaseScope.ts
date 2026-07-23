import type { Trade } from '@/data/trades'

export type ReviewCaseScope = 'all' | 'focus' | 'mistakes' | 'unreviewed' | 'reviewed'

/** 案例快捷视图与随机复盘共享同一成员判定，避免同名 scope 漂移。 */
export function matchesReviewCaseScope(
  trade: Trade,
  scope: ReviewCaseScope | undefined,
  starredIds: ReadonlySet<string>,
): boolean {
  if (trade.tradeKind !== 'case') return false
  if (!scope || scope === 'all') return true
  if (scope === 'focus') {
    return (
      starredIds.has(trade.id) ||
      trade.reviewCategory === 'focus' ||
      trade.reviewStatus === 'focus'
    )
  }
  if (scope === 'mistakes') {
    // 错过机会与错题互斥：未成交案例即使带错误标签也不进错题视图。
    if (trade.caseType === 'missed' || trade.status === 'missed') return false
    return (
      trade.caseType === 'mistake' ||
      trade.reviewCategory === 'mistake' ||
      trade.mistakeTags.length > 0
    )
  }
  if (scope === 'unreviewed') {
    return (
      trade.masteryState === 'new' ||
      trade.masteryState === 'recheck' ||
      trade.reviewCategory === 'recheck' ||
      trade.reviewStatus === 'unreviewed'
    )
  }
  return (
    trade.masteryState === 'mastered' ||
    trade.reviewCategory === 'mastered' ||
    trade.reviewStatus === 'reviewed'
  )
}
