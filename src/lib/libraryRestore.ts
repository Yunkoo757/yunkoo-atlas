import type { PersistencePause } from '@/storage/persistenceController'
import { clearReviewSessionFilters, clearReviewSessionStorage } from '@/lib/reviewSession'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import type { ParsedWebJournalArchive } from '@/lib/webJournalArchive'
import { flushStorageBeforeCutover, haltPersistAfterCutover, lockStorageCutoverInteraction } from '@/storage/cutover'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { storageDocumentSignal, suspendPersist } from '@/storage/persist'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { CommitJournalImportResult } from '@/types/journalBridge'

type RestoreSource = 'backup' | 'desktop-archive' | 'web-archive'

type RestoreOutcome =
  | { ok: true; committed: true }
  | { ok: false; committed?: boolean; error?: string; code?: string }

export class BackupRestoreFlushError extends Error {
  constructor() { super('恢复后保存失败，请勿关闭软件') }
}

function requireRecovery(source: RestoreSource, pause: PersistencePause): void {
  const message = source === 'backup'
    ? '备份替换已开始，但界面无法安全载入磁盘状态；已停止保存，请重新打开资料库'
    : '完整恢复后的内存载入失败，自动保存已暂停'
  haltPersistAfterCutover(pause, message, source === 'backup' ? 'reopen' : 'reload')
}

async function restoreCurrentLibrary(
  source: RestoreSource,
  replace: () => Promise<CommitJournalImportResult>,
  afterPublish?: () => Promise<void>,
): Promise<RestoreOutcome> {
  const signal = storageDocumentSignal
  const unlock = lockStorageCutoverInteraction(signal)
  try {
    await flushStorageBeforeCutover()
    signal.throwIfAborted()
    const pause = suspendPersist()
    // IndexedDB 拒绝表示事务已回滚。桌面 IPC 中断时，磁盘可能已经完成替换。
    let safeToFlush = source === 'web-archive'
    try {
      const result = await replace()
      signal.throwIfAborted()
      safeToFlush = !result.ok && result.committed === false
      if (!result.ok) return result
      if (!result.snapshot) return { ok: false, committed: true, error: '恢复后的资料库没有可读取快照' }

      const storage = source === 'web-archive' ? getIndexedDbAdapter() : getElectronAdapter()
      if (source !== 'web-archive') storage.clearObjectUrlCache()
      const manifest = await storage.getManifest()
      signal.throwIfAborted()
      clearReviewSessionStorage(manifest.libraryId)
      clearReviewSessionFilters(manifest.libraryId)
      replaceLibraryInStore(result.snapshot)
      safeToFlush = true
      signal.throwIfAborted()
      await afterPublish?.()
    } finally {
      if (signal.aborted) pause.resume({ flushNow: false })
      else if (!safeToFlush) requireRecovery(source, pause)
      else {
        try {
          await pause.resumeAndFlush()
        } catch (error) {
          signal.throwIfAborted()
          if (source === 'backup') throw new BackupRestoreFlushError()
          throw error
        }
      }
    }
    signal.throwIfAborted()
    return { ok: true, committed: true }
  } finally {
    unlock()
  }
}

export async function commitPreparedJournalArchive(token: string): Promise<RestoreOutcome> {
  const bridge = getJournalBridge()
  if (!bridge) return { ok: false, error: 'Electron bridge is not available' }
  return restoreCurrentLibrary('desktop-archive', () => bridge.commitPreparedJournalImport(token))
}

export async function restoreLibraryBackup(name: string, afterPublish: () => Promise<void>): Promise<RestoreOutcome> {
  const bridge = getJournalBridge()
  if (!bridge) return { ok: false, error: 'Electron bridge is not available' }
  return restoreCurrentLibrary('backup', () => bridge.restoreBackup(name), afterPublish)
}

export async function restoreWebJournalArchive(archive: ParsedWebJournalArchive): Promise<{ summary: string }> {
  if (isElectron()) throw new Error('浏览器归档恢复仅在 Web 存储中可用')
  const result = await restoreCurrentLibrary('web-archive', async () => {
    await getIndexedDbAdapter().replaceArchive(archive.snapshot, archive.assets, archive.recoveryOrphanAssetIds ?? [])
    return { ok: true, committed: true, snapshot: archive.snapshot }
  })
  if (!result.ok) throw new Error(result.error)
  const parts = [`${archive.snapshot.trades.length} 条记录`]
  if (archive.assets.length > 0) parts.push(`${archive.assets.length} 个附件`)
  return { summary: `已恢复 ${parts.join('、')}` }
}
