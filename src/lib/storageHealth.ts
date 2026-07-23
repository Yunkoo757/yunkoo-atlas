import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import { buildAssetInventory, type AssetInventory } from '@/storage/assetInventory'

export interface AssetStats {
  count: number
  totalBytes: number
  missingCount: number
  formattedSize: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface StorageHealth {
  tradeCount: number
  strategyCount: number
  attachmentCount: number
  attachmentStats: AssetStats
  orphanedAttachments: string[]
  inventory: AssetInventory
  estimatedTotal: string
}

async function readCurrentAssetInventory(): Promise<AssetInventory> {
  const storage = getStorage()
  if (!storage.listAssetRecords) {
    throw new Error('当前存储适配器不支持附件物理清单')
  }
  const { trades, weeklyReviews, quickNotes } = useStore.getState()
  const records = await storage.listAssetRecords()
  return buildAssetInventory({ trades, weeklyReviews, quickNotes }, records)
}

/** 只返回健康且没有被三个富文本域引用的已提交附件。 */
export async function detectOrphanedAttachments(): Promise<string[]> {
  return (await readCurrentAssetInventory()).orphan.map((record) => record.id)
}

export async function checkStorageHealth(): Promise<StorageHealth> {
  const { trades, strategies } = useStore.getState()
  const inventory = await readCurrentAssetInventory()
  const totalBytes = inventory.healthy.reduce(
    (sum, item) => sum + (item.record?.actualBytes ?? 0),
    0,
  )
  const attachmentStats = {
    count: inventory.healthy.length,
    totalBytes,
    missingCount: inventory.missing.length,
    formattedSize: formatBytes(totalBytes),
  }

  return {
    tradeCount: trades.length,
    strategyCount: strategies.length,
    attachmentCount: inventory.referenced.length,
    attachmentStats,
    orphanedAttachments: inventory.orphan.map((record) => record.id),
    inventory,
    estimatedTotal: attachmentStats.formattedSize,
  }
}

/** AST1 仅负责盘点；清理必须经后续带 revision/CAS 的 purge 流程。 */
export async function cleanOrphanedAttachments(_ids: string[]): Promise<number> {
  throw new Error('附件清理尚未启用，请使用带预览与 revision 校验的安全清理流程')
}
