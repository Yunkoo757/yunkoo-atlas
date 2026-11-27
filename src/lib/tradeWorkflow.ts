import { isReviewCompleted, type Trade } from '@/data/trades'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import { getReviewSessionContent, hasEffectiveReviewContent } from '@/lib/reviewSession'

/** 交易日志“待完善”的唯一判定：终态结果缺失，或终态记录还没有可阅读的复盘正文/截图。 */
export function isTradeIncomplete(trade: Trade): boolean {
  if (trade.deletedAt || trade.tradeKind === 'case') return false
  const truth = resolveTradeTruth(trade)
  if (truth.executionState !== 'closed' && truth.executionState !== 'missed') return false
  if (truth.executionState === 'closed' && !truth.isResultComplete) return true
  return !hasEffectiveReviewContent(getReviewSessionContent(trade))
}

export function isPendingReviewTrade(trade: Trade, truth = resolveTradeTruth(trade)): boolean {
  if (trade.deletedAt || trade.tradeKind === 'case' || isReviewCompleted(trade.reviewStatus)) return false
  return truth.executionState === 'missed' || (truth.executionState === 'closed' && truth.isResultComplete)
}

export function findNextPendingReviewId(
  fromId: string,
  orderedIds: readonly string[],
  trades: readonly Trade[],
): string | null {
  const start = orderedIds.indexOf(fromId)
  if (start < 0) return null
  const byId = new Map(trades.map(trade => [trade.id, trade]))
  for (let offset = 1; offset < orderedIds.length; offset++) {
    const candidate = byId.get(orderedIds[(start + offset) % orderedIds.length]!)
    if (candidate && isPendingReviewTrade(candidate)) return candidate.id
  }
  return null
}
