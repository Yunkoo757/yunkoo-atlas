/**
 * 自动清理过期数据（回收站功能）
 * 在应用启动时调用，清理超过 30 天的已删除案例及其关联资源
 */

import type { CaseRecord } from '@/data/case'
import { isExpired } from '@/data/case'
import type { Trade } from '@/data/trades'
import { isTradeExpired } from '@/data/trades'

/**
 * 清理过期的已删除案例
 * @param cases 所有案例数据
 * @param purgeCase 彻底删除函数
 * @param deleteAsset 删除资源函数
 * @returns 清理的案例数量
 */
export async function cleanExpiredTrash(
  cases: CaseRecord[],
  purgeCase: (id: string) => void,
  deleteAsset?: (fileId: string) => Promise<void>,
): Promise<number> {
  const expiredCases = cases.filter((c) => isExpired(c))

  if (expiredCases.length === 0) {
    return 0
  }

  // 清理关联的图片资源
  if (deleteAsset) {
    for (const c of expiredCases) {
      for (const img of c.images) {
        try {
          await deleteAsset(img.fileId)
        } catch (err) {
          console.error(`Failed to delete asset ${img.fileId}:`, err)
        }
      }
    }
  }

  // 从数据库移除案例
  for (const c of expiredCases) {
    purgeCase(c.id)
  }

  console.log(`[Trash Cleanup] Cleaned ${expiredCases.length} expired case(s)`)
  return expiredCases.length
}

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

/**
 * 获取回收站统计信息
 */
export function getTrashStats(cases: CaseRecord[]) {
  const trashCases = cases.filter((c) => c.deletedAt && !isExpired(c))
  const expiredCount = cases.filter((c) => isExpired(c)).length

  return {
    trashCount: trashCases.length,
    expiredCount,
    totalDeleted: trashCases.length + expiredCount,
  }
}
