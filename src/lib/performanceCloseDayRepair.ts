import type { Trade } from '@/data/trades'

export function collectPerformanceCloseDayRepairIds(
  candidateIds: readonly string[],
  trades: readonly Trade[],
): string[] {
  const liveIds = new Set(
    trades
      .filter((trade) => trade.tradeKind === 'live' && !trade.deletedAt)
      .map((trade) => trade.id),
  )
  return candidateIds.filter((id) => liveIds.has(id))
}
