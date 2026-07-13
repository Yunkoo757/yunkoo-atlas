import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import type { LibraryStorage } from './storage'
import { getLibraryPath, ensureLibraryDirs } from './paths'

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000 // 15 分钟
const DEFAULT_MAX_BACKUPS = 7
const DEFAULT_MAX_TOTAL_SIZE = 500 * 1024 * 1024 // 500 MB 备份总容量上限

interface BackupMeta {
  tradeCount: number
  strategyCount: number
  attachmentCount: number
  librarySizeBytes: number
  /** 该恢复点引用的原始附件文件；旧版元数据没有此字段。 */
  attachmentFiles?: string[]
  /** 原文件名与内容寻址仓库文件的映射。 */
  attachmentEntries?: { fileName: string; vaultName: string }[]
}

let intervalTimer: ReturnType<typeof setInterval> | null = null
let quitHandler: (() => void) | null = null
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
  const vaultName = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
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
): string | null {
  const { backups, dbFile, manifestFile, attachments } = ensureLibraryDirs(libraryPath)
  if (!fs.existsSync(dbFile)) return null

  const dest = path.join(backups, backupFileName(now))
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
  const meta: BackupMeta = {
    tradeCount: counts.tradeCount,
    strategyCount: counts.strategyCount,
    attachmentCount: counts.assetCount,
    librarySizeBytes: fs.statSync(dbFile).size,
    attachmentEntries,
  }
  fs.writeFileSync(dest + '.meta.json', JSON.stringify(meta), 'utf-8')
  return dest
}

export function createBackup(storage: LibraryStorage): string | null {
  try {
    const now = Date.now()
    const dest = createBackupAtPath(storage, getLibraryPath(), now)
    if (dest) lastBackupAt = now
    return dest
  } catch (err) {
    console.error('[backup] create failed', err)
    return null
  }
}

export function getBackupStatsAtPath(libraryPath: string): { count: number; totalSize: number } {
  const { backups } = ensureLibraryDirs(libraryPath)
  return {
    count: backupDbFiles(backups).length,
    totalSize: backupTotalSize(backups),
  }
}

export function deleteBackupAtPath(libraryPath: string, fileName: string): boolean {
  const { backups } = ensureLibraryDirs(libraryPath)
  const fp = path.join(backups, path.basename(fileName))
  if (!fs.existsSync(fp)) return false
  deleteBackupFiles(fp)
  pruneBackupAssetVault(backups)
  return true
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

  fs.copyFileSync(src, dbFile)
  const savedManifest = backupManifestPath(src)
  if (fs.existsSync(savedManifest)) fs.copyFileSync(savedManifest, manifestFile)

  if (stagedAttachments) {
    const previousAttachments = path.join(libraryPath, `.attachments-previous-${Date.now()}`)
    fs.renameSync(attachments, previousAttachments)
    try {
      fs.renameSync(stagedAttachments, attachments)
      fs.rmSync(previousAttachments, { recursive: true, force: true })
    } catch (error) {
      if (!fs.existsSync(attachments) && fs.existsSync(previousAttachments)) {
        fs.renameSync(previousAttachments, attachments)
      }
      fs.rmSync(stagedAttachments, { recursive: true, force: true })
      throw error
    }
  }
  return true
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
    const nonEmpty = files
      .filter((f) => f.tradeCount > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    const emptyOrUnknown = files
      .filter((f) => f.tradeCount <= 0)
      .sort((a, b) => b.timestamp - a.timestamp)
    for (const file of [...nonEmpty, ...emptyOrUnknown]) {
      if (keep.size >= maxCount) break
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
      .filter((file) => keep.has(file.path) && fs.existsSync(file.path))
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

export function listBackups(): { name: string; timestamp: number; size: number; tradeCount?: number; strategyCount?: number; attachmentCount?: number }[] {
  const { backups } = ensureLibraryDirs(getLibraryPath())
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
      // 读取元数据（如果存在）
      const metaPath = fp + '.meta.json'
      try {
        if (fs.existsSync(metaPath)) {
          const meta: BackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          info.tradeCount = meta.tradeCount
          info.strategyCount = meta.strategyCount
          info.attachmentCount = meta.attachmentCount
        }
      } catch { /* 元数据读取失败不影响列表 */ }
      return info
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function startAutoBackup(
  storage: LibraryStorage,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  maxBackups: number = DEFAULT_MAX_BACKUPS,
): void {
  stopAutoBackup()
  storageRef = storage
  rotateBackups(ensureLibraryDirs(getLibraryPath()).backups, maxBackups)

  // 定时备份
  intervalTimer = setInterval(() => {
    if (!storageRef) return
    const result = createBackup(storageRef)
    if (result) {
      const { backups } = ensureLibraryDirs(getLibraryPath())
      rotateBackups(backups, maxBackups)
    }
  }, intervalMs)

  // 退出前备份
  quitHandler = () => {
    if (storageRef) {
      // 正常关窗时渲染进程会先落盘并创建恢复点；这里只处理强制退出等兜底路径。
      if (Date.now() - lastBackupAt > 5000) {
        const result = createBackup(storageRef)
        if (result) {
          const { backups } = ensureLibraryDirs(getLibraryPath())
          rotateBackups(backups, maxBackups)
        }
      }
      storageRef.release()
    }
  }
  app.on('before-quit', quitHandler)
}

export function stopAutoBackup(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  if (quitHandler) {
    app.off('before-quit', quitHandler)
    quitHandler = null
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
