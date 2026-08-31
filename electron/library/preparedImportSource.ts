import { createHash } from 'node:crypto'
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

export interface PreparedJournalArchiveStaging {
  stagedArchivePath: string
  stagedArchiveSha256: string
  stagedLibraryRoot: string
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
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
  const stagedLibraryRoot = path.join(stagingRoot, 'library')
  fs.copyFileSync(sourceArchivePath, stagedArchivePath, fs.constants.COPYFILE_EXCL)
  const descriptor = fs.openSync(stagedArchivePath, 'r+')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
  fs.mkdirSync(stagedLibraryRoot)
  return {
    stagedArchivePath,
    stagedArchiveSha256: sha256(fs.readFileSync(stagedArchivePath)),
    stagedLibraryRoot,
  }
}

export function matchesStagedJournalArchive(
  archivePath: string,
  expectedSha256: string,
): boolean {
  try {
    const stat = fs.lstatSync(archivePath)
    return stat.isFile() && !stat.isSymbolicLink() &&
      sha256(fs.readFileSync(archivePath)) === expectedSha256
  } catch {
    return false
  }
}
