import type { Trade } from '@/data/trades'
import type { PersistedSnapshot } from '@/storage/types'

/**
 * v1.2.14 及更早版本要求 entry/size 必须是数字。
 * 新版运行时以 null 表示未知，但过渡期落盘继续编码为 0，确保分支测试后仍可回到主干。
 */
export function encodeTradesForLegacyReaders(trades: Trade[]): Trade[] {
  let changed = false
  const encoded = trades.map((trade) => {
    if (trade.entry !== null && trade.size !== null) return trade
    changed = true
    return {
      ...trade,
      entry: trade.entry ?? 0,
      size: trade.size ?? 0,
    }
  })
  return changed ? encoded : trades
}

export function encodeSnapshotForLegacyReaders(
  snapshot: PersistedSnapshot,
): PersistedSnapshot {
  const trades = encodeTradesForLegacyReaders(snapshot.trades)
  return trades === snapshot.trades ? snapshot : { ...snapshot, trades }
}
