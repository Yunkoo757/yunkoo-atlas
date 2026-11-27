import type { BackupRestoreResult, StorageRecoveryRequiredState } from '../../src/types/journalBridge'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { safeConsoleError } from '../diagnosticSanitizer'
import { createBackup, restoreBackupAtPath, rotateBackups, verifyBackupAtPath } from './backup'
import { getLibraryPaths } from './paths'
import type { LibraryStorage } from './storage'
import { withStorageRecoveryNotification } from './storageRecovery'

export async function createVerifiedRestorePoint(current: LibraryStorage): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const name = createBackup(current)
  if (!name) return { ok: false, error: '无法创建恢复前安全备份' }
  const verification = await verifyBackupAtPath(current.getLibraryPath(), name)
  if (verification.status !== 'verified') return { ok: false, error: verification.error ?? '恢复前安全备份验证失败' }
  return { ok: true }
}

interface BackupRestoreSession {
  withExclusiveWriter(work: (current: LibraryStorage) => Promise<RestoreReceipt>): Promise<RestoreReceipt>
  close(current: LibraryStorage): void
  reopen(): Promise<LibraryStorage>
  notifyRecoveryRequired(state: StorageRecoveryRequiredState): void
}

type RestoreReceipt =
  | Extract<BackupRestoreResult, { ok: false }>
  | (Extract<BackupRestoreResult, { ok: true }> & { revision: number })

export async function restoreLibraryBackup(fileName: string, session: BackupRestoreSession): Promise<RestoreReceipt> {
  // 仅本请求实际关闭旧实例后，renderer 才需要按可能已替换处理。
  let diskMayHaveChanged = false
  try {
    return await withStorageRecoveryNotification(() => session.withExclusiveWriter(async (current): Promise<RestoreReceipt> => {
      const libraryPath = current.getLibraryPath()
      const verification = await verifyBackupAtPath(libraryPath, fileName)
      if (verification.status !== 'verified') return { ok: false, committed: false, error: verification.error }
      const safety = await createVerifiedRestorePoint(current)
      if (!safety.ok) return { ok: false, committed: false, error: safety.error }

      const clean = current.createSnapshotDatabaseCleaner()
      session.close(current)
      diskMayHaveChanged = true
      let reopened: LibraryStorage | undefined
      try {
        const installed = restoreBackupAtPath(libraryPath, fileName, clean)
        reopened = await session.reopen()
        diskMayHaveChanged = installed
        rotateBackups(getLibraryPaths(libraryPath).backups)
        if (!installed) return { ok: false, committed: false, error: '恢复操作未提交' }
        let envelope = reopened.loadSnapshotEnvelope()
        if (!envelope.snapshot && verification.emptyLibrary) {
          reopened.saveSnapshot(createEmptyPersistedSnapshot())
          envelope = reopened.loadSnapshotEnvelope()
        }
        if (!envelope.snapshot) return { ok: false, committed: true, error: '恢复后的快照无法读取' }
        return { ok: true, committed: true, snapshot: envelope.snapshot, revision: envelope.revision }
      } finally {
        if (!reopened) {
          // 持锁重开并重建自动备份；写入资格由已确认的恢复结果决定。
          try { await session.reopen() }
          catch (error) { safeConsoleError('backup-reopen-after-restore-failed', error) }
        }
      }
    }), session.notifyRecoveryRequired)
  } catch (error) {
    safeConsoleError('backup-restore-failed', error)
    return { ok: false, committed: diskMayHaveChanged, error: error instanceof Error ? error.message : String(error) }
  }
}
