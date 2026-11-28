import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { safeConsoleError } from '../diagnosticSanitizer'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import type { BackupMeta } from './backupMetadata'
import { sha256File } from './fileChecksum'
import { assertRecoveryManifestIdentity } from './libraryIdentity'
import { assertDirectManagedChild, removeDirectManagedDirectory } from './managedPaths'
import { ensureLibraryDirs, getLibraryPaths } from './paths'

/** 私有目录回收失败只记录诊断；不能改变验证、安装或回滚的实际结果。 */
export function discardBackupWorkspace(root: string, directory: string): void {
  try {
    assertDirectManagedChild(root, directory, path.basename(directory))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) { safeConsoleError('backup-workspace-cleanup-failed', error) }
}

const BACKUP_RESTORE_MARKER = '.backup-restore.json'
const BACKUP_RESTORE_RECOVERY_PREFIX = '.backup-restore-recovery-'

interface BackupRestoreMarker {
  version: 1
  recoveryDir: string
  hadDatabase: boolean
  hadManifest: boolean
  databaseSha256?: string
  manifestSha256?: string
  installedDatabaseSha256?: string
  attachmentEntries?: Array<{ fileName: string; sha256: string }>
}

function backupRestoreMarkerPath(libraryRoot: string): string {
  return path.join(libraryRoot, BACKUP_RESTORE_MARKER)
}

function copyRestoreAttachments(
  source: string,
  destination: string,
): Array<{ fileName: string; sha256: string }> {
  const entries: Array<{ fileName: string; sha256: string }> = []
  fs.mkdirSync(destination, { recursive: true })
  for (const name of fs.existsSync(source) ? fs.readdirSync(source) : []) {
    const sourceFile = path.join(source, name)
    const stat = fs.lstatSync(sourceFile)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`附件目录包含无法安全恢复的项目：${name}`)
    }
    const destinationFile = path.join(destination, name)
    fs.copyFileSync(sourceFile, destinationFile)
    fsyncFileSync(destinationFile)
    entries.push({ fileName: name, sha256: sha256File(destinationFile) })
  }
  fsyncDirectorySync(destination)
  return entries
}

function validateBackupRestoreRecovery(marker: BackupRestoreMarker, recoveryRoot: string): void {
  const recoveryDb = path.join(recoveryRoot, 'journal.db')
  const recoveryManifest = path.join(recoveryRoot, 'manifest.json')
  const recoveryAttachments = path.join(recoveryRoot, 'attachments')
  if (marker.hadDatabase && !fs.existsSync(recoveryDb)) throw new Error('备份恢复数据库副本缺失')
  if (marker.hadManifest && !fs.existsSync(recoveryManifest)) throw new Error('备份恢复清单副本缺失')
  if (marker.hadDatabase && (!marker.databaseSha256 || sha256File(recoveryDb) !== marker.databaseSha256)) {
    throw new Error('备份恢复数据库 checksum 无效，已停止覆盖当前资料库')
  }
  if (marker.hadManifest && (!marker.manifestSha256 || sha256File(recoveryManifest) !== marker.manifestSha256)) {
    throw new Error('备份恢复清单 checksum 无效，已停止覆盖当前资料库')
  }
  if (!marker.attachmentEntries) throw new Error('备份恢复附件 checksum 清单缺失')
  const expected = new Map(marker.attachmentEntries.map((entry) => [entry.fileName, entry.sha256]))
  if (expected.size !== marker.attachmentEntries.length) throw new Error('备份恢复附件 checksum 清单无效')
  const actual = fs.existsSync(recoveryAttachments) ? fs.readdirSync(recoveryAttachments) : []
  if (actual.length !== expected.size) throw new Error('备份恢复附件 checksum 清单不完整')
  for (const name of actual) {
    const filePath = path.join(recoveryAttachments, name)
    const stat = fs.lstatSync(filePath)
    if (path.basename(name) !== name || !stat.isFile() || stat.isSymbolicLink() || !expected.has(name)) {
      throw new Error('备份恢复附件 checksum 清单无效')
    }
    if (sha256File(filePath) !== expected.get(name)) {
      throw new Error(`备份恢复附件 checksum 无效：${name}`)
    }
  }
}

export function recoverInterruptedBackupRestore(paths: ReturnType<typeof getLibraryPaths>, expectedLibraryId?: string): void {
  const markerPath = backupRestoreMarkerPath(paths.root)
  if (!fs.existsSync(markerPath)) return

  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Partial<BackupRestoreMarker>
  if (
    marker.version !== 1 ||
    typeof marker.recoveryDir !== 'string' ||
    path.basename(marker.recoveryDir) !== marker.recoveryDir ||
    !marker.recoveryDir.startsWith(BACKUP_RESTORE_RECOVERY_PREFIX) ||
    typeof marker.hadDatabase !== 'boolean' ||
    typeof marker.hadManifest !== 'boolean'
  ) {
    throw new Error('备份恢复标记损坏，已停止打开资料库以保护原数据')
  }

  const recoveryRoot = path.join(paths.root, marker.recoveryDir)
  assertDirectManagedChild(paths.root, recoveryRoot, marker.recoveryDir)
  if (!fs.existsSync(recoveryRoot)) {
    throw new Error('备份恢复安全副本缺失，已停止打开资料库以保护原数据')
  }
  const recoveryDb = path.join(recoveryRoot, 'journal.db')
  const recoveryManifest = path.join(recoveryRoot, 'manifest.json')
  const recoveryAttachments = path.join(recoveryRoot, 'attachments')
  validateBackupRestoreRecovery(marker as BackupRestoreMarker, recoveryRoot)
  assertRecoveryManifestIdentity(marker.hadManifest ? recoveryManifest : null, expectedLibraryId)

  if (marker.hadDatabase) writeFileAtomicallySync(paths.dbFile, fs.readFileSync(recoveryDb))
  else fs.rmSync(paths.dbFile, { force: true })
  if (marker.hadManifest) writeFileAtomicallySync(paths.manifestFile, fs.readFileSync(recoveryManifest))
  else fs.rmSync(paths.manifestFile, { force: true })
  removeDirectManagedDirectory(paths.root, paths.attachments, 'attachments')
  copyRestoreAttachments(recoveryAttachments, paths.attachments)
  fsyncDirectorySync(paths.root)
  fs.rmSync(markerPath, { force: true })
  fsyncDirectorySync(paths.root)
  discardBackupWorkspace(paths.root, recoveryRoot)
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 先为当前库生成可核验的回滚副本，发布标记后才允许替换活动文件。 */
function prepareRollback(paths: ReturnType<typeof getLibraryPaths>, installedDatabaseSha256: string): string {
  const { root, dbFile, manifestFile, attachments } = paths
  const markerPath = backupRestoreMarkerPath(root)
  if (fs.existsSync(markerPath)) throw new Error('存在待恢复的备份事务，请先重新打开资料库')
  const recoveryDir = `${BACKUP_RESTORE_RECOVERY_PREFIX}${randomUUID()}`
  const recoveryRoot = path.join(root, recoveryDir)
  fs.mkdirSync(recoveryRoot)
  try {
    const marker: BackupRestoreMarker = {
      version: 1,
      recoveryDir,
      hadDatabase: fs.existsSync(dbFile),
      hadManifest: fs.existsSync(manifestFile),
      installedDatabaseSha256,
    }
    const recoveryDb = path.join(recoveryRoot, 'journal.db')
    const recoveryManifest = path.join(recoveryRoot, 'manifest.json')
    if (marker.hadDatabase) {
      fs.copyFileSync(dbFile, recoveryDb)
      fsyncFileSync(recoveryDb)
      marker.databaseSha256 = sha256File(recoveryDb)
    }
    if (marker.hadManifest) {
      fs.copyFileSync(manifestFile, recoveryManifest)
      fsyncFileSync(recoveryManifest)
      marker.manifestSha256 = sha256File(recoveryManifest)
    }
    marker.attachmentEntries = copyRestoreAttachments(attachments, path.join(recoveryRoot, 'attachments'))
    fsyncDirectorySync(recoveryRoot)
    writeFileAtomicallySync(markerPath, JSON.stringify(marker, null, 2), 'utf8')
    return recoveryRoot
  } catch (error) {
    // 原子写入可能在标记已替换后报告刷新失败，已发布标记仍然需要这份副本。
    if (!fs.existsSync(markerPath)) discardBackupWorkspace(root, recoveryRoot)
    throw error
  }
}

export function installBackupCandidate(
  libraryPath: string,
  candidate: { paths: ReturnType<typeof getLibraryPaths>; entries: BackupMeta['attachmentEntries'] },
  cleanDatabaseBytes: (bytes: Buffer) => Buffer,
): void {
  const paths = ensureLibraryDirs(libraryPath)
  const { dbFile, manifestFile, attachments } = paths
  const restoredDatabaseBytes = cleanDatabaseBytes(fs.readFileSync(candidate.paths.dbFile))
  const installedDatabaseSha256 = sha256Bytes(restoredDatabaseBytes)
  const sourceManifestBytes = fs.existsSync(candidate.paths.manifestFile) ? fs.readFileSync(candidate.paths.manifestFile) : null
  if (candidate.entries) {
    for (const { fileName } of candidate.entries) fsyncFileSync(path.join(candidate.paths.attachments, fileName))
    fsyncDirectorySync(candidate.paths.attachments)
  }

  const recoveryRoot = prepareRollback(paths, installedDatabaseSha256)
  const markerPath = backupRestoreMarkerPath(libraryPath)

  try {
    if (candidate.entries) {
      removeDirectManagedDirectory(libraryPath, attachments, 'attachments')
      fs.renameSync(candidate.paths.attachments, attachments)
    }

    writeFileAtomicallySync(dbFile, restoredDatabaseBytes)
    if (sha256File(dbFile) !== installedDatabaseSha256) throw new Error('恢复候选数据库回读校验失败')
    if (sourceManifestBytes) {
      writeFileAtomicallySync(manifestFile, sourceManifestBytes)
    }
    for (const { fileName, vaultName } of candidate.entries ?? []) {
      if (/^[a-f0-9]{64}$/i.test(vaultName) && sha256File(path.join(attachments, fileName)) !== vaultName.toLowerCase()) {
        throw new Error(`Restored attachment checksum is invalid: ${fileName}`)
      }
    }
    fsyncDirectorySync(attachments)
    fsyncDirectorySync(libraryPath)
    fs.rmSync(markerPath, { force: true })
    fsyncDirectorySync(libraryPath)
  } catch (error) {
    recoverInterruptedBackupRestore(paths)
    throw error
  }
  discardBackupWorkspace(libraryPath, recoveryRoot)
}
