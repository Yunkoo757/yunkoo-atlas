import { fsyncFileSync } from './atomicFile'
import { sha256File } from './fileChecksum'
import fs from 'node:fs'
import path from 'node:path'

export interface StorageLifecycle {
  getLibraryPath(): string
  getLifecycleId(): string
}

export interface PreparedImportSource<TStorage extends StorageLifecycle = StorageLifecycle> {
  storage: TStorage
  lifecycleId: string
  libraryPath: string
}

/**
 * 恢复预览只绑定活动资料库的生命周期，不绑定 journal.db 的时间戳。
 * 同一生命周期内的自动保存属于正常写入；真正切库或重新打开会产生新实例与 lifecycleId。
 */
export function capturePreparedImportSource<TStorage extends StorageLifecycle>(
  storage: TStorage,
): PreparedImportSource<TStorage> {
  return {
    storage,
    lifecycleId: storage.getLifecycleId(),
    libraryPath: path.resolve(storage.getLibraryPath()),
  }
}

export function matchesPreparedImportSource<TStorage extends StorageLifecycle>(
  source: PreparedImportSource<TStorage>,
  current: TStorage | null,
): boolean {
  return current === source.storage &&
    current.getLifecycleId() === source.lifecycleId &&
    path.resolve(current.getLibraryPath()) === source.libraryPath
}

/** A failed installation consumes its preview. Unconfirmed recovery must keep renderer writes locked. */
export async function recoverPreparedImportCommitFailure<TStorage extends StorageLifecycle>(input: {
  error: unknown
  replacementCommitted: boolean
  currentStorage: () => TStorage | null
  reopen: () => Promise<TStorage>
  resumeRolledBackWriter: (storage: TStorage) => void
  invalidatePreview: () => void
  reportFailure?: (error: unknown) => void
}): Promise<{ ok: false; committed: boolean; code: 'TOKEN_EXPIRED'; error: string }> {
  let recovered: TStorage | null = null
  const reportFailure = (error: unknown) => {
    try { input.reportFailure?.(error) } catch { /* Diagnostics must not change recovery safety. */ }
  }
  reportFailure(input.error)
  try {
    recovered = input.currentStorage() ?? await input.reopen()
    if (!input.replacementCommitted) input.resumeRolledBackWriter(recovered)
  } catch (error) {
    recovered = null
    reportFailure(error)
  } finally {
    input.invalidatePreview()
  }
  const committed = input.replacementCommitted || recovered === null
  return {
    ok: false,
    // This flag also covers an unknown cutover outcome, so renderer must not flush its old snapshot.
    committed,
    code: 'TOKEN_EXPIRED',
    error: committed
      ? '恢复结果尚未确认，自动保存已暂停；请重新打开资料库核对后再操作。'
      : '恢复未完成，原资料库已恢复；请重新选择归档后重试。',
  }
}

export interface PreparedJournalArchiveStaging {
  archiveModifiedAt: number
  stagedArchivePath: string
  stagedArchiveSha256: string
}

/** 复制并锁定用户选择的归档字节；预览和最终恢复必须消费这一份私有副本。 */
export function stagePreparedJournalArchive(
  sourceArchivePath: string,
  stagingRoot: string,
): PreparedJournalArchiveStaging {
  const sourceStat = fs.lstatSync(sourceArchivePath)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('归档文件必须是普通文件')
  }
  const stagedArchivePath = path.join(stagingRoot, 'source.journal.zip')
  fs.copyFileSync(sourceArchivePath, stagedArchivePath, fs.constants.COPYFILE_EXCL)
  fsyncFileSync(stagedArchivePath)
  return {
    archiveModifiedAt: sourceStat.mtimeMs,
    stagedArchivePath,
    stagedArchiveSha256: sha256File(stagedArchivePath),
  }
}

export function matchesStagedJournalArchive(
  archivePath: string,
  expectedSha256: string,
): boolean {
  try {
    const stat = fs.lstatSync(archivePath)
    return stat.isFile() && !stat.isSymbolicLink() &&
      sha256File(archivePath) === expectedSha256
  } catch {
    return false
  }
}
