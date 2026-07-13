import type { Trade } from '@/data/trades'
import { resolveTradeTruth } from '@/lib/tradeTruth'

export interface TodayWorkflowBuckets {
  active: Trade[]
  resultPending: Trade[]
  reviewPending: Trade[]
  todayRecords: Trade[]
  actionCount: number
}

export function toLocalDateKey(value = new Date()): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

function newestFirst(left: Trade, right: Trade): number {
  const leftTime = left.closedAt ?? left.openedAt
  const rightTime = right.closedAt ?? right.openedAt
  return rightTime.localeCompare(leftTime)
}

function sameLocalDate(value: string | null | undefined, date: string): boolean {
  return Boolean(value?.slice(0, 10) === date)
}

/** 把交易库投影为互斥的今日行动队列，避免同一笔交易在多个区块重复出现。 */
export function getTodayWorkflowBuckets(
  trades: readonly Trade[],
  today: string,
): TodayWorkflowBuckets {
  const live = trades.filter((trade) => trade.tradeKind === 'live' && !trade.deletedAt)
  const active: Trade[] = []
  const resultPending: Trade[] = []
  const reviewPending: Trade[] = []
  const todayRecords: Trade[] = []

  for (const trade of live) {
    if (trade.status === 'planned' || trade.status === 'open') {
      active.push(trade)
      continue
    }

    const truth = resolveTradeTruth(trade)
    if (truth.executionState === 'closed' && !truth.isResultComplete) {
      resultPending.push(trade)
      continue
    }
    if (
      (truth.executionState === 'missed' ||
        (truth.executionState === 'closed' && truth.isResultComplete)) &&
      trade.reviewStatus !== 'reviewed'
    ) {
      reviewPending.push(trade)
      continue
    }
    if (sameLocalDate(trade.openedAt, today) || sameLocalDate(trade.closedAt, today)) {
      todayRecords.push(trade)
    }
  }

  active.sort(newestFirst)
  resultPending.sort(newestFirst)
  reviewPending.sort(newestFirst)
  todayRecords.sort(newestFirst)

  return {
    active,
    resultPending,
    reviewPending,
    todayRecords,
    actionCount: active.length + resultPending.length + reviewPending.length,
  }
}
