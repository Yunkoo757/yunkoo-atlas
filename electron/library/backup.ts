import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { LibraryStorage } from './storage'
import { getLibraryPath, ensureLibraryDirs, getLibraryPaths } from './paths'
import { writeFileAtomicallySync } from './atomicFile'
import { validateDesktopLibrary, validateLibraryDatabaseFile } from './journalZip'

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000 // 15 分钟
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

export interface BackupVerificationResult {
  status: 'verified' | 'invalid'
  checkedAt: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
  error?: string
  emptyLibrary?: boolean
}

let intervalTimer: ReturnType<typeof setInterval> | null = null
let lastBackupAt = 0
let storageRef: LibraryStorage | null = null

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

function listAttachmentFiles(attachmentsDir: string): string[] {
  if (!fs.existsSync(attachmentsDir)) return []
  return fs.readdirSync(attachmentsDir)
    .filter((name) => fs.statSync(path.join(attachmentsDir, name)).isFile())
    .sort()
}

function storeBackupAttachment(source: string, vault: string): string {
  const vaultName = sha256File(source)
  const destination = path.join(vault, vaultName)
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination)
  return vaultName
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
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
    for (const attachment of meta?.attachmentFiles ?? []) referenced.add(attachment)
    for (const attachment of meta?.attachmentEntries ?? []) referenced.add(attachment.vaultName)
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

export function createBackupAtPath(
  storage: Pick<LibraryStorage, 'getCounts'>,
  libraryPath: string,
  now: number = Date.now(),
  options: { emptyLibrary?: boolean } = {},
): string | null {
  const { backups, dbFile, manifestFile, attachments } = ensureLibraryDirs(libraryPath)
  if (!fs.existsSync(dbFile)) return null

  let timestamp = now
  let dest = path.join(backups, backupFileName(timestamp))
  while (fs.existsSync(dest)) {
    timestamp += 1
    dest = path.join(backups, backupFileName(timestamp))
  }
  try {
    fs.copyFileSync(dbFile, dest)
    if (fs.existsSync(manifestFile)) {
      fs.copyFileSync(manifestFile, backupManifestPath(dest))
    }

    const attachmentFiles = listAttachmentFiles(attachments)
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
    const meta: BackupMeta = {
      tradeCount: counts.tradeCount,
      strategyCount: counts.strategyCount,
      attachmentCount: counts.assetCount,
      librarySizeBytes: fs.statSync(dbFile).size,
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
    const now = Date.now()
    const dest = createBackupAtPath(storage, storage.getLibraryPath(), now, options)
    if (dest) lastBackupAt = now
    return dest
  } catch (err) {
    console.error('[backup] create failed', err)
    return null
  }
}

export function getBackupStatsAtPath(libraryPath: string): { count: number; totalSize: number } {
  const { backups } = getLibraryPaths(libraryPath)
  return {
    count: backupDbFiles(backups).length,
    totalSize: backupTotalSize(backups),
  }
}

export function listBackupsAtPath(libraryPath: string): ReturnType<typeof listBackups> {
  const { backups } = getLibraryPaths(libraryPath)
  if (!fs.existsSync(backups)) return []

  return fs
    .readdirSync(backups)
    .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))
    .map((f) => {
      const fp = path.join(backups, f)
      const stat = fs.statSync(fp)
      const info: ReturnType<typeof listBackups>[number] = {
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

export async function verifyBackupAtPath(
  libraryPath: string,
  fileName: string,
): Promise<BackupVerificationResult> {
  const { backups } = getLibraryPaths(libraryPath)
  const dbPath = path.join(backups, path.basename(fileName))
  const checkedAt = Date.now()
  if (!fs.existsSync(dbPath)) {
    return { status: 'invalid', checkedAt, error: '恢复点文件不存在' }
  }

  let inspection: Awaited<ReturnType<typeof validateLibraryDatabaseFile>> | undefined
  const verificationRoot = fs.mkdtempSync(path.join(libraryPath, '.backup-verify-'))
  try {
    try {
      const declaredMeta = readBackupMeta(dbPath)
      const declaredEmptyLibrary = declaredMeta?.emptyLibrary === true &&
        declaredMeta.tradeCount === 0 &&
        declaredMeta.strategyCount === 0 &&
        declaredMeta.attachmentCount === 0 &&
        (declaredMeta.attachmentEntries?.length ?? 0) === 0 &&
        (declaredMeta.attachmentFiles?.length ?? 0) === 0
      inspection = await validateLibraryDatabaseFile(dbPath, {
        allowEmptySnapshot: declaredEmptyLibrary,
      })
    } catch {
      throw new Error('数据库或快照结构无法读取')
    }

    const meta = readBackupMeta(dbPath)
    const attachmentEntries = meta?.attachmentEntries ?? meta?.attachmentFiles?.map((name) => ({
      fileName: name,
      vaultName: name,
    }))
    if (inspection.assets.length > 0 && !attachmentEntries) {
      throw new Error('恢复点缺少附件清单')
    }
    if (meta) {
      if (meta.tradeCount !== inspection.tradeCount || meta.strategyCount !== inspection.strategyCount) {
        throw new Error('恢复点统计与数据库内容不一致')
      }
      if (meta.attachmentCount !== inspection.assets.length) {
        throw new Error('恢复点附件统计与数据库内容不一致')
      }
      if (meta.librarySizeBytes !== fileSize(dbPath)) {
        throw new Error('恢复点数据库大小与元数据不一致')
      }
      if (meta.databaseSha256 && sha256File(dbPath) !== meta.databaseSha256) {
        throw new Error('恢复点数据库校验失败')
      }
      const savedManifest = backupManifestPath(dbPath)
      if (meta.manifestSha256 && (!fs.existsSync(savedManifest) || sha256File(savedManifest) !== meta.manifestSha256)) {
        throw new Error('恢复点清单校验失败')
      }
    }

    const staged = ensureLibraryDirs(verificationRoot)
    fs.copyFileSync(dbPath, staged.dbFile)
    const savedManifest = backupManifestPath(dbPath)
    if (fs.existsSync(savedManifest)) fs.copyFileSync(savedManifest, staged.manifestFile)

    const entriesByName = new Map<string, string>()
    for (const entry of attachmentEntries ?? []) {
      if (
        !entry.fileName ||
        !entry.vaultName ||
        path.basename(entry.fileName) !== entry.fileName ||
        path.basename(entry.vaultName) !== entry.vaultName ||
        entriesByName.has(entry.fileName)
      ) {
        throw new Error('恢复点附件清单损坏')
      }
      const source = path.join(backupAssetVault(backups), entry.vaultName)
      if (!fs.existsSync(source)) throw new Error(`缺少附件：${entry.fileName}`)
      if (/^[a-f0-9]{64}$/i.test(entry.vaultName)) {
        const digest = sha256File(source)
        if (digest !== entry.vaultName.toLowerCase()) throw new Error(`附件校验失败：${entry.fileName}`)
      }
      entriesByName.set(entry.fileName, source)
      fs.copyFileSync(source, path.join(staged.attachments, entry.fileName))
    }

    for (const asset of inspection.assets) {
      const source = entriesByName.get(asset.fileName)
      if (!source) throw new Error(`缺少数据库引用的附件：${asset.fileName}`)
      if (fileSize(source) !== asset.byteSize) throw new Error(`附件大小不一致：${asset.fileName}`)
    }

    const declaredEmptyLibrary = meta?.emptyLibrary === true &&
      meta.tradeCount === 0 &&
      meta.strategyCount === 0 &&
      meta.attachmentCount === 0 &&
      (meta.attachmentEntries?.length ?? 0) === 0 &&
      (meta.attachmentFiles?.length ?? 0) === 0
    const stagedInspection = await validateDesktopLibrary(staged, {
      allowEmptySnapshot: declaredEmptyLibrary,
    })
    if (
      stagedInspection.tradeCount !== inspection.tradeCount ||
      stagedInspection.strategyCount !== inspection.strategyCount ||
      stagedInspection.assets.length !== inspection.assets.length
    ) {
      throw new Error('临时恢复后的数据统计不一致')
    }

    const result: BackupVerificationResult = {
      status: 'verified',
      checkedAt,
      tradeCount: stagedInspection.tradeCount,
      strategyCount: stagedInspection.strategyCount,
      attachmentCount: stagedInspection.assets.length,
      ...(declaredEmptyLibrary ? { emptyLibrary: true } : {}),
    }
    persistBackupVerification(dbPath, result, inspection)
    return result
  } catch (error) {
    const result: BackupVerificationResult = {
      status: 'invalid',
      checkedAt,
      tradeCount: inspection?.tradeCount,
      strategyCount: inspection?.strategyCount,
      attachmentCount: inspection?.assets.length,
      error: error instanceof Error ? error.message : '恢复点验证失败',
    }
    try {
      persistBackupVerification(dbPath, result, inspection)
    } catch {
      /* 元数据本身不可写时仍返回验证结果 */
    }
    return result
  } finally {
    fs.rmSync(verificationRoot, { recursive: true, force: true })
  }
}

export function verifyBackup(fileName: string): Promise<BackupVerificationResult> {
  return verifyBackupAtPath(getLibraryPath(), path.basename(fileName))
}

export function restoreBackupAtPath(libraryPath: string, fileName: string): boolean {
  const { backups, dbFile, manifestFile, attachments } = ensureLibraryDirs(libraryPath)
  const safeName = path.basename(fileName)
  const src = path.join(backups, safeName)
  if (!fs.existsSync(src)) return false

  const meta = readBackupMeta(src)
  const attachmentEntries = meta?.attachmentEntries ?? meta?.attachmentFiles?.map((fileName) => ({
    fileName,
    vaultName: fileName,
  }))
  let stagedAttachments: string | null = null
  if (attachmentEntries) {
    const vault = backupAssetVault(backups)
    stagedAttachments = path.join(libraryPath, `.attachments-restore-${Date.now()}`)
    fs.mkdirSync(stagedAttachments, { recursive: true })
    try {
      for (const entry of attachmentEntries) {
        const fileName = path.basename(entry.fileName)
        const vaultName = path.basename(entry.vaultName)
        const source = path.join(vault, vaultName)
        if (!fs.existsSync(source)) throw new Error(`Backup attachment is missing: ${fileName}`)
        fs.copyFileSync(source, path.join(stagedAttachments, fileName))
      }
    } catch (error) {
      fs.rmSync(stagedAttachments, { recursive: true, force: true })
      throw error
    }
  }

  const originalDb = fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : null
  const originalManifest = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile) : null
  const savedManifest = backupManifestPath(src)
  let previousAttachments: string | null = null
  try {
    if (stagedAttachments) {
      previousAttachments = path.join(libraryPath, `.attachments-previous-${Date.now()}`)
      fs.renameSync(attachments, previousAttachments)
      fs.renameSync(stagedAttachments, attachments)
    }

    writeFileAtomicallySync(dbFile, fs.readFileSync(src))
    if (fs.existsSync(savedManifest)) {
      writeFileAtomicallySync(manifestFile, fs.readFileSync(savedManifest))
    }
    if (previousAttachments) {
      fs.rmSync(previousAttachments, { recursive: true, force: true })
      previousAttachments = null
    }
    return true
  } catch (error) {
    if (originalDb) writeFileAtomicallySync(dbFile, originalDb)
    else fs.rmSync(dbFile, { force: true })
    if (originalManifest) writeFileAtomicallySync(manifestFile, originalManifest)
    else fs.rmSync(manifestFile, { force: true })
    if (previousAttachments && fs.existsSync(previousAttachments)) {
      fs.rmSync(attachments, { recursive: true, force: true })
      fs.renameSync(previousAttachments, attachments)
    }
    if (stagedAttachments) {
      fs.rmSync(stagedAttachments, { recursive: true, force: true })
    }
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
        return {
          name: f,
          path: fp,
          timestamp: parseTimestampFromName(f) || 0,
          tradeCount: readBackupTradeCount(fp),
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp) // 最新在前

    // 优先保留有交易的备份，避免空库备份把好备份挤掉
    const keep = new Set<string>()
    const newestPath = files[0]?.path
    if (newestPath) keep.add(newestPath)
    const nonEmpty = files
      .filter((f) => f.tradeCount > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    const emptyOrUnknown = files
      .filter((f) => f.tradeCount <= 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    for (const file of [...nonEmpty, ...emptyOrUnknown]) {
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
        return left.timestamp - right.timestamp
      })
    for (const file of capacityCandidates) {
      if (backupTotalSize(backupsDir) <= maxTotalSize) break
      deleteBackupFiles(file.path)
      pruneBackupAssetVault(backupsDir)
    }
  } catch (err) {
    console.error('[backup] rotate failed', err)
  }
}

/** 获取备份总大小信息 */
export function getBackupStats(): { count: number; totalSize: number } {
  return getBackupStatsAtPath(getLibraryPath())
}

export function listBackups(): { name: string; timestamp: number; size: number; tradeCount?: number; strategyCount?: number; attachmentCount?: number; verification?: BackupVerificationResult }[] {
  return listBackupsAtPath(getLibraryPath())
}

export function startAutoBackup(
  storage: LibraryStorage,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  maxBackups: number = DEFAULT_MAX_BACKUPS,
): void {
  stopAutoBackup()
  storageRef = storage
  lastBackupAt = 0
  const libraryPath = storage.getLibraryPath()
  rotateBackups(ensureLibraryDirs(libraryPath).backups, maxBackups)

  // 定时备份
  intervalTimer = setInterval(() => {
    if (!storageRef) return
    const result = createBackup(storageRef)
    if (result) {
      const { backups } = ensureLibraryDirs(storageRef.getLibraryPath())
      rotateBackups(backups, maxBackups)
    }
  }, intervalMs)

}

export function stopAutoBackup(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  storageRef = null
}

export function restoreBackup(fileName: string): boolean {
  try {
    return restoreBackupAtPath(getLibraryPath(), path.basename(fileName))
  } catch (err) {
    console.error('[backup] restore failed', err)
    return false
  }
}

export function deleteBackup(fileName: string): boolean {
  try {
    return deleteBackupAtPath(getLibraryPath(), fileName)
  } catch {
    return false
  }
}
