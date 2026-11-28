import type { BackupReference, BackupRestoreResult, StorageRecoveryRequiredState } from '../../src/types/journalBridge'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { safeConsoleError } from '../diagnosticSanitizer'
import { createVerifiedBackup, selectedBackupFile, withVerifiedBackup } from './backup'
import type { LibraryTarget } from './libraryIdentity'
import type { LibraryStorage } from './storage'
import { withStorageRecoveryNotification } from './storageRecovery'

export interface RestorePoint extends LibraryTarget {
  backupPath: string
}

export async function createVerifiedRestorePoint(
  current: LibraryStorage,
  assertTarget: (target: LibraryTarget) => void,
): Promise<{ ok: true; point: RestorePoint } | { ok: false; error: string }> {
  const target = current.getOpenedTarget()
  assertTarget(target)
  const backup = await createVerifiedBackup(current)
  if (!backup) return { ok: false, error: '无法创建恢复前安全备份' }
  if (backup.status !== 'verified') return { ok: false, error: backup.error ?? '恢复前安全备份验证失败' }
  return { ok: true, point: { ...target, backupPath: backup.path } }
}

interface BackupRestoreSession {
  withExclusiveWriter(work: (current: LibraryStorage) => Promise<RestoreReceipt>): Promise<RestoreReceipt>
  assertTarget(target: LibraryTarget): void
  close(current: LibraryStorage): void
  reopen(point: RestorePoint): Promise<LibraryStorage>
  notifyRecoveryRequired(state: StorageRecoveryRequiredState): void
}

type RestoreReceipt =
  | Extract<BackupRestoreResult, { ok: false }>
  | (Extract<BackupRestoreResult, { ok: true }> & { revision: number })

export async function restoreLibraryBackup(reference: BackupReference, session: BackupRestoreSession): Promise<RestoreReceipt> {
  // 仅本请求实际关闭旧实例后，renderer 才需要按可能已替换处理。
  let diskMayHaveChanged = false
  try {
    return await withStorageRecoveryNotification(() => session.withExclusiveWriter(async (current): Promise<RestoreReceipt> => {
      const libraryPath = current.getLibraryPath()
      const fileName = selectedBackupFile(current, reference)
      return withVerifiedBackup(libraryPath, fileName, current.readManifest().libraryId, async (verification, install): Promise<RestoreReceipt> => {
        if (!install) return { ok: false, committed: false, error: verification.error }
        const safety = await createVerifiedRestorePoint(current, session.assertTarget)
        if (!safety.ok) return { ok: false, committed: false, error: safety.error }

        const clean = current.createSnapshotDatabaseCleaner()
        session.close(current)
        diskMayHaveChanged = true
        let reopened: LibraryStorage | undefined
        try {
          install(clean)
          reopened = await session.reopen(safety.point)
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
            try { await session.reopen(safety.point) }
            catch (error) { safeConsoleError('backup-reopen-after-restore-failed', error) }
          }
        }
      })
    }), session.notifyRecoveryRequired)
  } catch (error) {
    safeConsoleError('backup-restore-failed', error)
    return { ok: false, committed: diskMayHaveChanged, error: error instanceof Error ? error.message : String(error) }
  }
}
