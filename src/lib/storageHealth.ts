import { useStore } from '@/store/useStore'
import { collectAssetIdsFromNotes, getStorage } from '@/storage'

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
  /** 孤立附件（不在任何笔记中引用的资产 ID 列表） */
  orphanedAttachments: string[]
  /** 预估的总存储占用（格式化） */
  estimatedTotal: string
}

/** 收集所有已知的资产 ID（notes 中引用 + 存储中实际存在） */
async function collectStoredAssetIds(): Promise<Set<string>> {
  const storage = getStorage()
  // 从所有笔记中收集引用的资产 ID
  const trades = useStore.getState().trades
  const referencedIds = collectAssetIdsFromNotes(trades)

  // 对于 IndexedDB/Electron，尝试获取实际存储的资产列表
  const storedIds = new Set(referencedIds)
  try {
    const snapshot = await storage.loadSnapshot()
    if (!snapshot) return storedIds
  } catch {
    // 忽略
  }
  return storedIds
}

/** 检测孤立附件：存储中有但不在任何笔记中引用的资产 */
export async function detectOrphanedAttachments(): Promise<string[]> {
  const trades = useStore.getState().trades
  const referencedIds = collectAssetIdsFromNotes(trades)

  // 尝试从存储中获取所有已知资产
  // Electron: 扫描 attachments/ 目录
  // Web: IndexedDB 中可能有额外记录
  const orphaned: string[] = []

  try {
    // 通过 bridge 或直接获取所有存储的资产 ID
    const allIds = await getAllKnownAssetIds()
    for (const id of allIds) {
      if (!referencedIds.includes(id)) {
        orphaned.push(id)
      }
    }
  } catch {
    // 无法获取时返回空
  }

  return orphaned
}

/** 获取所有已知资产 ID */
async function getAllKnownAssetIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const storage = getStorage()
    const snapshot = await storage.loadSnapshot()
    if (!snapshot) return ids

    // 从 trades 的 note HTML 中提取引用
    for (const t of snapshot.trades) {
      const note = typeof t.note === 'string' ? t.note : ''
      const matches = note.matchAll(/(?:journal-asset:\/\/|attachment:)\/?([^\s"'<)]+)/g)
      for (const m of matches) {
        if (m[1]) ids.add(m[1].replace(/\/$/, ''))
      }
    }
  } catch {
    // 忽略
  }
  return ids
}

/** 完整存储健康检查 */
export async function checkStorageHealth(): Promise<StorageHealth> {
  const { trades, strategies } = useStore.getState()
  const orphaned = await detectOrphanedAttachments()

  // 收集实际资产
  const storage = getStorage()
  const assetIds = collectAssetIdsFromNotes(trades)
  const measured = await storage.getAssetStats(assetIds)
  const attachmentStats = {
    ...measured,
    formattedSize: formatBytes(measured.totalBytes),
  }
  const estimatedTotal = attachmentStats.formattedSize

  return {
    tradeCount: trades.length,
    strategyCount: strategies.length,
    attachmentCount: assetIds.length,
    attachmentStats,
    orphanedAttachments: orphaned,
    estimatedTotal,
  }
}

/** 清理孤立附件（Electron: 删除文件; Web: 从 IndexedDB 删除） */
export async function cleanOrphanedAttachments(ids: string[]): Promise<number> {
  let cleaned = 0
  // 注意：当前存储接口没有直接的 deleteAsset 方法
  // 对 IndexedDB，需要通过特定方式删除
  // 对 Electron，删除 attachments/ 下文件
  try {
    const bridge = (window as any).journalBridge
    if (bridge?.deleteAsset) {
      for (const id of ids) {
        try {
          await bridge.deleteAsset(id)
          cleaned++
        } catch {
          // 跳过删除失败的
        }
      }
    }
  } catch {
    // 忽略
  }
  return cleaned
}
