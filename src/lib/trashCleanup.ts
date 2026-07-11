/**
 * 自动清理过期数据（回收站功能）
 * 在应用启动时调用，清理超过 30 天的已删除交易
 */

import type { Trade } from '@/data/trades'
import { isTradeExpired } from '@/data/trades'

export async function cleanExpiredTradeTrash(
  trades: Trade[],
  purgeTrade: (id: string) => void,
): Promise<number> {
  const expiredTrades = trades.filter((t) => isTradeExpired(t))

  for (const t of expiredTrades) {
    purgeTrade(t.id)
  }

  if (expiredTrades.length > 0) {
    console.log(`[Trash Cleanup] Cleaned ${expiredTrades.length} expired trade(s)`)
  }

  return expiredTrades.length
}
