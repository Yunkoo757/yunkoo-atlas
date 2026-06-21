import fs from 'node:fs'
import path from 'node:path'
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

export function createBackup(storage: LibraryStorage): string | null {
  try {
    const { backups, dbFile } = ensureLibraryDirs(getLibraryPath())
    if (!fs.existsSync(dbFile)) return null

    const now = Date.now()
    const dest = path.join(backups, backupFileName(now))
    fs.copyFileSync(dbFile, dest)
    lastBackupAt = now

    // 写入备份元数据（交易数/策略数/附件数/库大小）
    try {
      const counts = storage.getCounts()
      const meta: BackupMeta = {
        tradeCount: counts.tradeCount,
        strategyCount: counts.strategyCount,
        attachmentCount: counts.assetCount,
        librarySizeBytes: (() => { try { return fs.statSync(dbFile).size } catch { return 0 } })(),
      }
      fs.writeFileSync(dest + '.meta.json', JSON.stringify(meta), 'utf-8')
    } catch (metaErr) {
      console.error('[backup] meta write failed', metaErr)
    }

    return dest
  } catch (err) {
    console.error('[backup] create failed', err)
    return null
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
          size: (() => { try { return fs.statSync(fp).size } catch { return 0 } })(),
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp) // 最新在前

    // 按数量限制删除
    const toDelete = new Set<string>()
    for (const file of files.slice(maxCount)) {
      toDelete.add(file.path)
    }

    // 按总容量限制删除（保留最新且不超限）
    let totalSize = 0
    for (const file of files) {
      if (toDelete.has(file.path)) continue
      totalSize += file.size
      if (totalSize > maxTotalSize) {
        toDelete.add(file.path)
      }
    }

    for (const p of toDelete) {
      try { fs.unlinkSync(p) } catch { /* 忽略 */ }
      try { const mp = p + '.meta.json'; if (fs.existsSync(mp)) fs.unlinkSync(mp) } catch { /* 忽略 */ }
    }
  } catch (err) {
    console.error('[backup] rotate failed', err)
  }
}

/** 获取备份总大小信息 */
export function getBackupStats(): { count: number; totalSize: number } {
  const { backups } = ensureLibraryDirs(getLibraryPath())
  if (!backups || !fs.existsSync(backups)) return { count: 0, totalSize: 0 }

  const files = fs
    .readdirSync(backups)
    .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))

  let totalSize = 0
  for (const f of files) {
    try { totalSize += fs.statSync(path.join(backups, f)).size } catch { /* 忽略 */ }
  }
  return { count: files.length, totalSize }
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
      const result = createBackup(storageRef)
      if (result) {
        const { backups } = ensureLibraryDirs(getLibraryPath())
        rotateBackups(backups, maxBackups)
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
    const { backups, dbFile } = ensureLibraryDirs(getLibraryPath())
    const src = path.join(backups, fileName)
    if (!fs.existsSync(src)) return false

    // 恢复前先备份当前状态
    if (fs.existsSync(dbFile)) {
      const rescue = path.join(backups, `pre-restore-${Date.now()}.db`)
      fs.copyFileSync(dbFile, rescue)
    }

    fs.copyFileSync(src, dbFile)
    return true
  } catch (err) {
    console.error('[backup] restore failed', err)
    return false
  }
}

export function deleteBackup(fileName: string): boolean {
  try {
    const { backups } = ensureLibraryDirs(getLibraryPath())
    const fp = path.join(backups, fileName)
    if (!fs.existsSync(fp)) return false
    fs.unlinkSync(fp)
    // 同步清理元数据文件
    const metaPath = fp + '.meta.json'
    try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath) } catch { /* 忽略 */ }
    return true
  } catch {
    return false
  }
}
