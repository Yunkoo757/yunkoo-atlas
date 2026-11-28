import type { BackupInfo, BackupVerificationResult } from '../../src/types/journalBridge'
import { sha256File } from './fileChecksum'
import { backupAttachmentEntries, readBackupMetadata, recordBackupVerification, tryReadBackupMeta, type BackupMeta } from './backupMetadata'
import fs from 'node:fs'
import path from 'node:path'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs, getLibraryPaths } from './paths'
import { writeFileAtomicallySync } from './atomicFile'
import { LibraryInspectionError, validateDesktopLibrary, type LibraryDatabaseInspection } from './libraryInspection'
import { safeConsoleError } from '../diagnosticSanitizer'
import { installBackupCandidate } from './backupRestoreFiles'
import { discardLibraryWorkspace } from './libraryReplacement'

const DEFAULT_MAX_BACKUPS = 7
const DEFAULT_MAX_TOTAL_SIZE = 500 * 1024 * 1024 // 500 MB 备份总容量上限

function backupFileName(timestamp: number): string {
  const iso = new Date(timestamp).toISOString().replace(/[:T.]/g, '-')
  return `journal-${iso}.db`
}

function parseTimestampFromName(name: string): number | null {
  const m = name.match(/^journal-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/)
  if (!m) return null
  const ts = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number(m[7]),
  )
  return isNaN(ts) ? null : ts
}

function backupAssetVault(backupsDir: string): string {
  return path.join(backupsDir, 'assets')
}

function backupManifestPath(dbBackupPath: string): string {
  return dbBackupPath + '.manifest.json'
}

function listDeclaredAttachmentFiles(
  attachmentsDir: string,
  declaredFileNames: readonly string[],
): string[] {
  const files: string[] = []
  for (const fileName of [...declaredFileNames].sort()) {
    if (!fileName || path.basename(fileName) !== fileName) {
      throw new Error(`备份附件路径不安全：${fileName}`)
    }
    const fullPath = path.join(attachmentsDir, fileName)
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`备份缺少数据库声明的附件：${fileName}`)
    }
    files.push(fileName)
  }
  return files
}

function storeBackupAttachment(source: string, vault: string): string {
  const vaultName = sha256File(source)
  const destination = path.join(vault, vaultName)
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination)
  return vaultName
}

function backupDbFiles(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return []
  return fs.readdirSync(backupsDir)
    .filter((name) => name.startsWith('journal-') && name.endsWith('.db'))
}

function pruneBackupAssetVault(backupsDir: string): void {
  const referenced = new Set<string>()
  for (const name of backupDbFiles(backupsDir)) {
    const meta = tryReadBackupMeta(path.join(backupsDir, name))
    if (!meta || meta.verification?.status === 'invalid') return
    try {
      for (const entry of backupAttachmentEntries(meta) ?? []) referenced.add(entry.vaultName)
      for (const name of meta.attachmentFiles ?? []) referenced.add(name)
    } catch { return }
  }
  const vault = backupAssetVault(backupsDir)
  if (!fs.existsSync(vault)) return
  for (const name of fs.readdirSync(vault)) {
    if (!referenced.has(name)) fs.rmSync(path.join(vault, name), { force: true })
  }
}

function fileSize(pathname: string): number {
  try {
    return fs.statSync(pathname).isFile() ? fs.statSync(pathname).size : 0
  } catch {
    return 0
  }
}

function backupTotalSize(backupsDir: string): number {
  if (!fs.existsSync(backupsDir)) return 0
  let total = 0
  for (const name of fs.readdirSync(backupsDir)) {
    const pathname = path.join(backupsDir, name)
    if (name === 'assets' && fs.statSync(pathname).isDirectory()) {
      for (const asset of fs.readdirSync(pathname)) total += fileSize(path.join(pathname, asset))
    } else {
      total += fileSize(pathname)
    }
  }
  return total
}

function deleteBackupFiles(dbPath: string): void {
  fs.rmSync(dbPath, { force: true })
  fs.rmSync(dbPath + '.meta.json', { force: true })
  fs.rmSync(backupManifestPath(dbPath), { force: true })
}

export function writeLibraryBackup(
  storage: Pick<LibraryStorage, 'getLibraryPath' | 'getCounts' | 'listCommittedAttachmentFileNames' | 'exportSnapshotDatabaseBytes'>,
  now: number = Date.now(),
  options: { emptyLibrary?: boolean } = {},
): string | null {
  const { backups, dbFile, manifestFile, attachments } = ensureLibraryDirs(storage.getLibraryPath())
  if (!fs.existsSync(dbFile)) return null

  let timestamp = now
  let dest = path.join(backups, backupFileName(timestamp))
  while (fs.existsSync(dest)) {
    timestamp += 1
    dest = path.join(backups, backupFileName(timestamp))
  }
  try {
    writeFileAtomicallySync(dest, storage.exportSnapshotDatabaseBytes())
    if (fs.existsSync(manifestFile)) {
      fs.copyFileSync(manifestFile, backupManifestPath(dest))
    }

    // 只打包 assets 表声明的文件；Windows 延迟 GC 残留的孤儿不得进入恢复点。
    const attachmentFiles = listDeclaredAttachmentFiles(
      attachments,
      storage.listCommittedAttachmentFileNames(),
    )
    const vault = backupAssetVault(backups)
    fs.mkdirSync(vault, { recursive: true })
    const attachmentEntries = attachmentFiles.map((fileName) => ({
      fileName,
      vaultName: storeBackupAttachment(path.join(attachments, fileName), vault),
    }))

    const counts = storage.getCounts()
    if (
      options.emptyLibrary &&
      (counts.tradeCount !== 0 || counts.strategyCount !== 0 || counts.assetCount !== 0 || attachmentEntries.length !== 0)
    ) {
      throw new Error('只有零交易、零策略、零附件的资料库才能标记为空库恢复点')
    }
    if (counts.assetCount !== attachmentEntries.length) {
      throw new Error('备份附件清单与数据库附件计数不一致')
    }
    const meta: BackupMeta = {
      tradeCount: counts.tradeCount,
      strategyCount: counts.strategyCount,
      attachmentCount: counts.assetCount,
      librarySizeBytes: fs.statSync(dest).size,
      databaseSha256: sha256File(dest),
      ...(fs.existsSync(backupManifestPath(dest))
        ? { manifestSha256: sha256File(backupManifestPath(dest)) }
        : {}),
      attachmentEntries,
      ...(options.emptyLibrary ? { emptyLibrary: true as const } : {}),
    }
    writeFileAtomicallySync(dest + '.meta.json', JSON.stringify(meta), 'utf8')
    return dest
  } catch (error) {
    deleteBackupFiles(dest)
    pruneBackupAssetVault(backups)
    throw error
  }
}

export function createBackup(
  storage: LibraryStorage,
  options: { emptyLibrary?: boolean } = {},
): string | null {
  try {
    return writeLibraryBackup(storage, Date.now(), options)
  } catch (err) {
    safeConsoleError('backup-create-failed', err)
    return null
  }
}

export function createRotatedBackup(storage: LibraryStorage): string | null {
  const backup = createBackup(storage)
  if (backup) rotateBackups(ensureLibraryDirs(storage.getLibraryPath()).backups)
  return backup
}

export function getBackupStatsAtPath(libraryPath: string): { count: number; totalSize: number } {
  const { backups } = getLibraryPaths(libraryPath)
  return {
    count: backupDbFiles(backups).length,
    totalSize: backupTotalSize(backups),
  }
}

export function listBackupsAtPath(libraryPath: string): BackupInfo[] {
  const { backups } = getLibraryPaths(libraryPath)
  if (!fs.existsSync(backups)) return []

  return fs
    .readdirSync(backups)
    .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))
    .map((f) => {
      const fp = path.join(backups, f)
      const stat = fs.statSync(fp)
      const info: BackupInfo = {
        name: f,
        timestamp: parseTimestampFromName(f) || stat.mtimeMs,
        size: stat.size,
      }
      const meta = tryReadBackupMeta(fp)
      if (meta) {
        info.tradeCount = meta.tradeCount
        info.strategyCount = meta.strategyCount
        info.attachmentCount = meta.attachmentCount
        info.verification = meta.verification
      }
      return info
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function deleteBackupAtPath(libraryPath: string, fileName: string): boolean {
  const { backups } = getLibraryPaths(libraryPath)
  const fp = path.join(backups, path.basename(fileName))
  if (!fs.existsSync(fp)) return false
  deleteBackupFiles(fp)
  pruneBackupAssetVault(backups)
  return true
}

type BackupCandidate = ReturnType<typeof stageBackupFiles>
type InstallBackup = (cleanDatabaseBytes: (bytes: Buffer) => Buffer) => void

/** 复制完再校验私有文件。旧恢复点的附件名与内容寻址仓库共用此入口。 */
function stageBackupFiles(dbPath: string, stagingRoot: string, meta: BackupMeta | null) {
  const paths = ensureLibraryDirs(stagingRoot)
  fs.copyFileSync(dbPath, paths.dbFile)
  if (meta?.databaseSha256 && sha256File(paths.dbFile) !== meta.databaseSha256) {
    throw new Error('恢复点数据库校验失败')
  }
  if (meta && meta.librarySizeBytes !== fileSize(paths.dbFile)) throw new Error('恢复点数据库大小与元数据不一致')

  const savedManifest = backupManifestPath(dbPath)
  if (fs.existsSync(savedManifest)) fs.copyFileSync(savedManifest, paths.manifestFile)
  if (meta?.manifestSha256 && (!fs.existsSync(paths.manifestFile) || sha256File(paths.manifestFile) !== meta.manifestSha256)) {
    throw new Error('恢复点清单校验失败')
  }

  const entries = backupAttachmentEntries(meta)
  const vault = backupAssetVault(path.dirname(dbPath))
  for (const { fileName, vaultName } of entries ?? []) {
    const destination = path.join(paths.attachments, fileName)
    fs.copyFileSync(path.join(vault, vaultName), destination, fs.constants.COPYFILE_EXCL)
    if (/^[a-f0-9]{64}$/i.test(vaultName) && sha256File(destination) !== vaultName.toLowerCase()) {
      throw new Error(`附件校验失败：${fileName}`)
    }
  }
  return { paths, meta, entries }
}

function declaredEmptyBackup(meta: BackupMeta | null): boolean {
  return meta?.emptyLibrary === true && meta.tradeCount === 0 && meta.strategyCount === 0 &&
    meta.attachmentCount === 0 && (meta.attachmentEntries?.length ?? 0) === 0 &&
    (meta.attachmentFiles?.length ?? 0) === 0
}

export function verifyBackupAtPath(
  libraryPath: string,
  fileName: string,
  expectedLibraryId?: string,
): Promise<BackupVerificationResult> {
  return withVerifiedBackup(libraryPath, fileName, expectedLibraryId, verification => verification)
}

export async function withVerifiedBackup<T>(
  libraryPath: string,
  fileName: string,
  expectedLibraryId: string | undefined,
  use: (verification: BackupVerificationResult, install?: InstallBackup) => T | Promise<T>,
): Promise<T> {
  const dbPath = path.join(getLibraryPaths(libraryPath).backups, path.basename(fileName))
  const checkedAt = Date.now()
  if (!fs.existsSync(dbPath)) return use({ status: 'invalid', checkedAt, error: '恢复点文件不存在' })
  const verificationRoot = fs.mkdtempSync(path.join(libraryPath, '.backup-verify-'))
  try {
    let inspection: LibraryDatabaseInspection | undefined
    let metadata: ReturnType<typeof readBackupMetadata> | undefined
    let candidate: BackupCandidate
    let result: BackupVerificationResult
    try {
      metadata = readBackupMetadata(dbPath)
      candidate = stageBackupFiles(dbPath, verificationRoot, metadata.value)
      const { meta, paths } = candidate
      const emptyLibrary = declaredEmptyBackup(meta)
      inspection = await validateDesktopLibrary(paths, { allowEmptySnapshot: emptyLibrary })
      if (meta && (meta.tradeCount !== inspection.tradeCount || meta.strategyCount !== inspection.strategyCount ||
          meta.attachmentCount !== inspection.assets.length)) throw new Error('恢复点统计与数据库内容不一致')

      const { LibraryStorage } = await import('./storage')
      const storage = new LibraryStorage(paths.root, { ensureDirectories: false, allowCreate: false })
      try {
        await storage.open(expectedLibraryId)
        if (!storage.loadSnapshot() && !emptyLibrary) throw new Error('临时恢复库无法由正式存储层打开')
      } finally { storage.release() }
      result = {
        status: 'verified', checkedAt, tradeCount: inspection.tradeCount, strategyCount: inspection.strategyCount,
        attachmentCount: inspection.assets.length, ...(emptyLibrary ? { emptyLibrary: true } : {}),
      }
      recordBackupVerification(dbPath, metadata, result)
    } catch (error) {
      result = {
        status: 'invalid', checkedAt, tradeCount: inspection?.tradeCount, strategyCount: inspection?.strategyCount,
        attachmentCount: inspection?.assets.length,
        error: error instanceof LibraryInspectionError && error.part === 'database'
          ? '数据库或快照结构无法读取'
          : error instanceof Error ? error.message : '恢复点验证失败',
      }
      try {
        if (metadata) recordBackupVerification(dbPath, metadata, result)
      } catch { /* 验证期间说明已变或不可写时仍返回失败。 */ }
      return await use(result)
    }
    return await use(result, clean => installBackupCandidate(libraryPath, candidate, clean))
  } finally {
    discardLibraryWorkspace(libraryPath, verificationRoot)
  }
}

export function restoreBackupAtPath(
  libraryPath: string,
  fileName: string,
  cleanDatabaseBytes: (bytes: Buffer) => Buffer = bytes => bytes,
): boolean {
  const dbPath = path.join(getLibraryPaths(libraryPath).backups, path.basename(fileName))
  if (!fs.existsSync(dbPath)) return false
  const stagingRoot = fs.mkdtempSync(path.join(libraryPath, '.backup-restore-staging-'))
  try {
    installBackupCandidate(libraryPath, stageBackupFiles(dbPath, stagingRoot, readBackupMetadata(dbPath).value), cleanDatabaseBytes)
    return true
  } finally {
    discardLibraryWorkspace(libraryPath, stagingRoot)
  }
}

export function rotateBackups(
  backupsDir: string,
  maxCount: number = DEFAULT_MAX_BACKUPS,
  maxTotalSize: number = DEFAULT_MAX_TOTAL_SIZE,
): void {
  try {
    if (!fs.existsSync(backupsDir)) return
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))
      .map((f) => {
        const fp = path.join(backupsDir, f)
        const meta = tryReadBackupMeta(fp)
        return {
          name: f,
          path: fp,
          timestamp: parseTimestampFromName(f) || 0,
          tradeCount: typeof meta?.tradeCount === 'number' ? meta.tradeCount : -1,
          verified: meta?.verification?.status === 'verified',
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp) // 最新在前

    // 优先保留有交易的备份，避免空库备份把好备份挤掉
    const keep = new Set<string>()
    const newestPath = files[0]?.path
    if (newestPath) keep.add(newestPath)
    const verifiedNonEmpty = files
      .filter((file) => file.path !== newestPath && file.verified && file.tradeCount > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    const nonEmpty = files
      .filter((file) => file.path !== newestPath && !file.verified && file.tradeCount > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    const verifiedEmptyOrUnknown = files
      .filter((file) => file.path !== newestPath && file.verified && file.tradeCount <= 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    const emptyOrUnknown = files
      .filter((file) => file.path !== newestPath && !file.verified && file.tradeCount <= 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    for (const file of [...verifiedNonEmpty, ...nonEmpty, ...verifiedEmptyOrUnknown, ...emptyOrUnknown]) {
      if (keep.size >= Math.max(1, maxCount)) break
      keep.add(file.path)
    }

    const toDelete = new Set<string>()
    for (const file of files) {
      if (!keep.has(file.path)) toDelete.add(file.path)
    }

    for (const p of toDelete) {
      deleteBackupFiles(p)
      keep.delete(p)
    }
    pruneBackupAssetVault(backupsDir)

    // 总容量包含数据库、清单、元数据与去重附件；超限时先删空备份，再删最旧备份。
    const capacityCandidates = files
      .filter(
        (file) =>
          keep.has(file.path) && file.path !== newestPath && fs.existsSync(file.path),
      )
      .sort((left, right) => {
        const leftEmpty = left.tradeCount <= 0
        const rightEmpty = right.tradeCount <= 0
        if (leftEmpty !== rightEmpty) return leftEmpty ? -1 : 1
        if (left.verified !== right.verified) return left.verified ? 1 : -1
        return left.timestamp - right.timestamp
      })
    for (const file of capacityCandidates) {
      if (backupTotalSize(backupsDir) <= maxTotalSize) break
      deleteBackupFiles(file.path)
      pruneBackupAssetVault(backupsDir)
    }
  } catch (err) {
    safeConsoleError('backup-rotate-failed', err)
  }
}
