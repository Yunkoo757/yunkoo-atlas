/**
 * 自动清理过期数据（回收站功能）
 * 在应用启动时调用，清理超过 30 天的已删除交易
 */

import type { Trade } from '@/data/trades'
import { getTradeRemainingDays, isTradeExpired } from '@/data/trades'
import { toast } from '@/lib/toast'
import type { TradePurgeResult } from '@/store/useStore'
import { useStore } from '@/store/useStore'

export const TRASH_EXPIRING_SOON_DAYS = 7

export function countExpiringTradeTrash(
  trades: readonly Trade[],
  withinDays = TRASH_EXPIRING_SOON_DAYS,
): number {
  return trades.filter((trade) => {
    const remaining = getTradeRemainingDays(trade)
    return remaining !== null && remaining <= withinDays
  }).length
}

export async function runStartupTrashCleanup(): Promise<number> {
  try {
    const { trades, purgeTrades } = useStore.getState()
    const cleaned = await cleanExpiredTradeTrash(trades, purgeTrades)
    if (cleaned > 0) {
      toast(`已永久清空 ${cleaned} 笔过期回收站记录`)
    }
    return cleaned
  } catch (error) {
    console.warn('[Trash Cleanup] startup cleanup failed', error)
    return 0
  }
}

export async function cleanExpiredTradeTrash(
  trades: Trade[],
  purgeTrades: (ids: string[]) => TradePurgeResult | void,
): Promise<number> {
  const expiredTrades = trades.filter((t) => isTradeExpired(t))
  if (expiredTrades.length === 0) return 0

  const result = purgeTrades(expiredTrades.map((trade) => trade.id))
  const cleanedCount = result?.purgedIds.length ?? expiredTrades.length
  const blockedCount = result?.blockedIds.length ?? 0

  if (cleanedCount > 0) console.log(`[Trash Cleanup] Cleaned ${cleanedCount} expired trade(s)`)
  if (blockedCount > 0) {
    console.warn(
      `[Trash Cleanup] Kept ${blockedCount} expired trade(s) required by stage repair or legacy completed reviews`,
    )
  }

  return cleanedCount
}
