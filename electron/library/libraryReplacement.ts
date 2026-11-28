import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeConsoleError } from '../diagnosticSanitizer'
import { copyLibraryAttachments } from './attachmentFiles'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import { sha256File } from './fileChecksum'
import { assertRecoveryManifestIdentity } from './libraryIdentity'
import { assertDirectManagedChild, removeDirectManagedDirectory } from './managedPaths'
import { getLibraryPaths } from './paths'

type LibraryPaths = ReturnType<typeof getLibraryPaths>
const formats = {
  journal: { marker: '.journal-import.json', prefix: '.pre-import-' },
  backup: { marker: '.backup-restore.json', prefix: '.backup-restore-recovery-' },
} as const
type Format = keyof typeof formats

interface RecoveryMarker {
  version: 1
  recoveryDir: string
  hadDatabase: boolean
  hadManifest: boolean
  databaseSha256?: string
  manifestSha256?: string
  installedDatabaseSha256?: string
  attachmentEntries: { fileName: string; sha256: string }[]
}

/** 私有目录回收失败只记录诊断；不能改变验证、安装或回滚的实际结果。 */
export function discardLibraryWorkspace(root: string, directory: string): void {
  try {
    assertDirectManagedChild(root, directory, path.basename(directory))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) { safeConsoleError('library-workspace-cleanup-failed', error) }
}

function copySavedFile(source: string, destination: string): string | undefined {
  if (!fs.existsSync(source)) return undefined
  fs.copyFileSync(source, destination)
  fsyncFileSync(destination)
  return sha256File(destination)
}

function verifySavedFile(file: string, present: boolean, checksum?: string): void {
  if (fs.existsSync(file) !== present ||
      (present && (!fs.lstatSync(file).isFile() || !checksum || sha256File(file) !== checksum))) {
    throw new Error('资料库恢复副本 checksum 无效，已停止覆盖当前资料库')
  }
}

function finish(paths: LibraryPaths, markerPath: string, directory: string): void {
  fsyncDirectorySync(paths.root)
  fs.rmSync(markerPath, { force: true })
  fsyncDirectorySync(paths.root)
  discardLibraryWorkspace(paths.root, directory)
}

function restoreSavedFile(saved: string, destination: string, present: boolean): void {
  if (present) writeFileAtomicallySync(destination, fs.readFileSync(saved))
  else fs.rmSync(destination, { force: true })
}

function recover(paths: LibraryPaths, kind: Format, expectedLibraryId?: string): void {
  const format = formats[kind]
  const markerPath = path.join(paths.root, format.marker)
  if (!fs.existsSync(markerPath)) return
  let marker: RecoveryMarker
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) }
  catch { throw new Error('资料库恢复标记无法读取，已停止打开资料库') }
  if (!marker || marker.version !== 1 || typeof marker.recoveryDir !== 'string' ||
      !marker.recoveryDir.startsWith(format.prefix) || path.basename(marker.recoveryDir) !== marker.recoveryDir ||
      typeof marker.hadDatabase !== 'boolean' || typeof marker.hadManifest !== 'boolean' ||
      !Array.isArray(marker.attachmentEntries)) throw new Error('资料库恢复标记损坏，已停止打开资料库')

  const saved = getLibraryPaths(path.join(paths.root, marker.recoveryDir))
  assertDirectManagedChild(paths.root, saved.root, marker.recoveryDir)
  if (!fs.existsSync(saved.root)) throw new Error('资料库恢复副本缺失，已停止打开资料库')
  verifySavedFile(saved.dbFile, marker.hadDatabase, marker.databaseSha256)
  verifySavedFile(saved.manifestFile, marker.hadManifest, marker.manifestSha256)
  assertDirectManagedChild(saved.root, saved.attachments, 'attachments')
  const actual = new Set(fs.existsSync(saved.attachments) ? fs.readdirSync(saved.attachments) : [])
  for (const entry of marker.attachmentEntries) {
    if (!entry || !actual.delete(entry.fileName)) throw new Error('资料库恢复附件 checksum 清单无效')
    verifySavedFile(path.join(saved.attachments, entry.fileName), true, entry.sha256)
  }
  if (actual.size) throw new Error('资料库恢复附件 checksum 清单不完整')
  assertRecoveryManifestIdentity(marker.hadManifest ? saved.manifestFile : null, expectedLibraryId)

  restoreSavedFile(saved.dbFile, paths.dbFile, marker.hadDatabase)
  restoreSavedFile(saved.manifestFile, paths.manifestFile, marker.hadManifest)
  // 备份安装会移动整个附件目录；归档就地复制，回滚保留其对非普通目标项的拒绝规则。
  if (kind === 'backup') removeDirectManagedDirectory(paths.root, paths.attachments, 'attachments')
  copyLibraryAttachments(saved.attachments, paths.attachments, { durable: true })
  finish(paths, markerPath, saved.root)
}

/** 与历史客户端的开库顺序一致，两种 v1 标记均使用原文件名和原副本前缀。 */
export function recoverInterruptedLibraryReplacement(paths: LibraryPaths, expectedLibraryId?: string): void {
  recover(paths, 'journal', expectedLibraryId)
  recover(paths, 'backup', expectedLibraryId)
}

/** 调用方持有写入权。只有副本和标记均已发布，才能取得替换当前文件的资格。 */
export function beginLibraryReplacement(paths: LibraryPaths, kind: Format, installedDatabaseSha256?: string) {
  if (Object.values(formats).some(format => fs.existsSync(path.join(paths.root, format.marker)))) {
    throw new Error('存在待恢复的资料库替换事务，请先重新打开资料库')
  }
  const format = formats[kind]
  const markerPath = path.join(paths.root, format.marker)
  const recoveryDir = format.prefix + randomUUID()
  const saved = getLibraryPaths(path.join(paths.root, recoveryDir))
  fs.mkdirSync(saved.root)
  try {
    const databaseSha256 = copySavedFile(paths.dbFile, saved.dbFile)
    const manifestSha256 = copySavedFile(paths.manifestFile, saved.manifestFile)
    const marker: RecoveryMarker = {
      version: 1, recoveryDir, hadDatabase: databaseSha256 !== undefined, hadManifest: manifestSha256 !== undefined,
      databaseSha256, manifestSha256, installedDatabaseSha256,
      attachmentEntries: copyLibraryAttachments(paths.attachments, saved.attachments, { durable: true, checksum: true }),
    }
    fsyncDirectorySync(saved.root)
    writeFileAtomicallySync(markerPath, JSON.stringify(marker, null, 2), 'utf8')
  } catch (error) {
    // 标记可能已被替换而目录刷新失败，保留其引用的副本。
    if (!fs.existsSync(markerPath)) discardLibraryWorkspace(paths.root, saved.root)
    throw error
  }
  return {
    directory: saved.root,
    commit: () => finish(paths, markerPath, saved.root),
    rollback: () => recover(paths, kind),
  }
}
