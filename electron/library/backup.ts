import type { BackupInfo, BackupVerificationResult } from '../../src/types/journalBridge'
import { assertRecoveryManifestIdentity } from './libraryIdentity'
import { sha256File } from './fileChecksum'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs, getLibraryPaths } from './paths'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import { validateDesktopLibrary, type LibraryDatabaseInspection } from './journalZip'
import { safeConsoleError } from '../diagnosticSanitizer'
import { removeDirectManagedDirectory } from './managedPaths'

const DEFAULT_MAX_BACKUPS = 7
const DEFAULT_MAX_TOTAL_SIZE = 500 * 1024 * 1024 // 500 MB 备份总容量上限

interface BackupMeta {
  tradeCount: number
  strategyCount: number
  attachmentCount: number
  librarySizeBytes: number
  databaseSha256?: string
  manifestSha256?: string
  /** 该恢复点引用的原始附件文件；旧版元数据没有此字段。 */
  attachmentFiles?: string[]
  /** 原文件名与内容寻址仓库文件的映射。 */
  attachmentEntries?: { fileName: string; vaultName: string }[]
  verification?: BackupVerificationResult
  /** 仅退出协调器可写：源库尚未产生 snapshot，且交易、策略、附件计数均为零。 */
  emptyLibrary?: true
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
  durable = false,
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
    if (durable) fsyncFileSync(destinationFile)
    entries.push({ fileName: name, sha256: sha256File(destinationFile) })
  }
  if (durable) fsyncDirectorySync(destination)
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
  copyRestoreAttachments(recoveryAttachments, paths.attachments, true)
  fsyncDirectorySync(paths.root)
  fs.rmSync(markerPath, { force: true })
  fsyncDirectorySync(paths.root)
  removeDirectManagedDirectory(paths.root, recoveryRoot, marker.recoveryDir)
}

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

function readBackupTradeCount(dbPath: string): number {
  try {
    const metaPath = dbPath + '.meta.json'
    if (!fs.existsSync(metaPath)) return -1
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BackupMeta
    return typeof meta.tradeCount === 'number' ? meta.tradeCount : -1
  } catch {
    return -1
  }
}

function readBackupMeta(dbPath: string): BackupMeta | null {
  try {
    const metaPath = dbPath + '.meta.json'
    if (!fs.existsSync(metaPath)) return null
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BackupMeta
  } catch {
    return null
  }
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

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function backupDbFiles(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return []
  return fs.readdirSync(backupsDir)
    .filter((name) => name.startsWith('journal-') && name.endsWith('.db'))
}

function pruneBackupAssetVault(backupsDir: string): void {
  const referenced = new Set<string>()
  for (const name of backupDbFiles(backupsDir)) {
    const meta = readBackupMeta(path.join(backupsDir, name))
    if (!meta) return
    for (const attachment of meta.attachmentFiles ?? []) referenced.add(attachment)
    for (const attachment of meta.attachmentEntries ?? []) referenced.add(attachment.vaultName)
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
      const metaPath = fp + '.meta.json'
      try {
        if (fs.existsSync(metaPath)) {
          const meta: BackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
          info.tradeCount = meta.tradeCount
          info.strategyCount = meta.strategyCount
          info.attachmentCount = meta.attachmentCount
          info.verification = meta.verification
        }
      } catch { /* 元数据读取失败不影响列表 */ }
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

function persistBackupVerification(
  dbPath: string,
  result: BackupVerificationResult,
  inspection?: { tradeCount: number; strategyCount: number; assets: unknown[] },
): void {
  const current = readBackupMeta(dbPath)
  const meta: BackupMeta = current ?? {
    tradeCount: inspection?.tradeCount ?? -1,
    strategyCount: inspection?.strategyCount ?? -1,
    attachmentCount: inspection?.assets.length ?? -1,
    librarySizeBytes: fileSize(dbPath),
  }
  meta.verification = result
  writeFileAtomicallySync(dbPath + '.meta.json', JSON.stringify(meta), 'utf8')
}

type BackupCandidate = ReturnType<typeof stageBackupFiles>
type InstallBackup = (cleanDatabaseBytes: (bytes: Buffer) => Buffer) => void

/** 复制完再校验私有文件。旧恢复点的附件名与内容寻址仓库共用此入口。 */
function stageBackupFiles(dbPath: string, stagingRoot: string) {
  const paths = ensureLibraryDirs(stagingRoot)
  const meta = readBackupMeta(dbPath)
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

  const entries = meta?.attachmentEntries ?? meta?.attachmentFiles?.map(fileName => ({ fileName, vaultName: fileName }))
  const vault = backupAssetVault(path.dirname(dbPath))
  for (const { fileName, vaultName } of entries ?? []) {
    if (!fileName || !vaultName || path.basename(fileName) !== fileName || path.basename(vaultName) !== vaultName) {
      throw new Error('恢复点附件清单损坏')
    }
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
    let candidate: BackupCandidate
    let result: BackupVerificationResult
    try {
      candidate = stageBackupFiles(dbPath, verificationRoot)
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
      persistBackupVerification(dbPath, result, inspection)
    } catch (error) {
      result = {
        status: 'invalid', checkedAt, tradeCount: inspection?.tradeCount, strategyCount: inspection?.strategyCount,
        attachmentCount: inspection?.assets.length, error: error instanceof Error ? error.message : '恢复点验证失败',
      }
      try { persistBackupVerification(dbPath, result, inspection) } catch { /* 仍返回验证结果。 */ }
      return await use(result)
    }
    return await use(result, clean => installBackupCandidate(libraryPath, candidate, clean))
  } finally {
    fs.rmSync(verificationRoot, { recursive: true, force: true, maxRetries: 3 })
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
    installBackupCandidate(libraryPath, stageBackupFiles(dbPath, stagingRoot), cleanDatabaseBytes)
    return true
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 3 })
  }
}

function installBackupCandidate(
  libraryPath: string,
  candidate: BackupCandidate,
  cleanDatabaseBytes: (bytes: Buffer) => Buffer,
): void {
  const { dbFile, manifestFile, attachments } = ensureLibraryDirs(libraryPath)
  const restoredDatabaseBytes = cleanDatabaseBytes(fs.readFileSync(candidate.paths.dbFile))
  const installedDatabaseSha256 = sha256Bytes(restoredDatabaseBytes)
  const sourceManifestBytes = fs.existsSync(candidate.paths.manifestFile) ? fs.readFileSync(candidate.paths.manifestFile) : null
  if (candidate.entries) {
    for (const { fileName } of candidate.entries) fsyncFileSync(path.join(candidate.paths.attachments, fileName))
    fsyncDirectorySync(candidate.paths.attachments)
  }

  const recoveryDir = `${BACKUP_RESTORE_RECOVERY_PREFIX}${randomUUID()}`
  const recoveryRoot = path.join(libraryPath, recoveryDir)
  const markerPath = backupRestoreMarkerPath(libraryPath)
  fs.mkdirSync(recoveryRoot, { recursive: true })
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
  marker.attachmentEntries = copyRestoreAttachments(
    attachments,
    path.join(recoveryRoot, 'attachments'),
    true,
  )
  fsyncDirectorySync(recoveryRoot)
  writeFileAtomicallySync(markerPath, JSON.stringify(marker, null, 2), 'utf8')

  try {
    if (candidate.entries) {
      removeDirectManagedDirectory(libraryPath, attachments, 'attachments')
      fs.renameSync(candidate.paths.attachments, attachments)
    }

    writeFileAtomicallySync(dbFile, restoredDatabaseBytes)
    if (sha256File(dbFile) !== marker.installedDatabaseSha256) throw new Error('恢复候选数据库回读校验失败')
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
    removeDirectManagedDirectory(libraryPath, recoveryRoot, recoveryDir)
  } catch (error) {
    recoverInterruptedBackupRestore(getLibraryPaths(libraryPath))
    throw error
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
        const meta = readBackupMeta(fp)
        return {
          name: f,
          path: fp,
          timestamp: parseTimestampFromName(f) || 0,
          tradeCount: readBackupTradeCount(fp),
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
