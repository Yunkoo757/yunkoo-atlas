import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { LibraryStorage } from './storage'
import { getLibraryPath, ensureLibraryDirs } from './paths'

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000 // 15 分钟
const DEFAULT_MAX_BACKUPS = 20

let intervalTimer: ReturnType<typeof setInterval> | null = null
let quitHandler: (() => void) | null = null
let lastBackupAt = 0
let storageRef: LibraryStorage | null = null

function backupFileName(timestamp: number): string {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, '-')
  return `journal-${iso}.db`
}

function parseTimestampFromName(name: string): number | null {
  const m = name.match(/^journal-(.+)\.db$/)
  if (!m) return null
  return Date.parse(m[1].replace(/-/g, ':').replace(/(\d{2})(\d{2})$/, '.$2'))
}

export function createBackup(storage: LibraryStorage): string | null {
  try {
    const { backups, dbFile } = ensureLibraryDirs(getLibraryPath())
    if (!fs.existsSync(dbFile)) return null

    const now = Date.now()
    const dest = path.join(backups, backupFileName(now))
    fs.copyFileSync(dbFile, dest)
    lastBackupAt = now
    return dest
  } catch (err) {
    console.error('[backup] create failed', err)
    return null
  }
}

export function rotateBackups(backupsDir: string, maxCount: number = DEFAULT_MAX_BACKUPS): void {
  try {
    if (!fs.existsSync(backupsDir)) return
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))
      .map((f) => ({
        name: f,
        path: path.join(backupsDir, f),
        timestamp: parseTimestampFromName(f) ?? 0,
      }))
      .sort((a, b) => b.timestamp - a.timestamp) // 最新在前

    // 删除超出保留数量的旧备份
    for (const file of files.slice(maxCount)) {
      fs.unlinkSync(file.path)
    }
  } catch (err) {
    console.error('[backup] rotate failed', err)
  }
}

export function listBackups(): { name: string; timestamp: number; size: number }[] {
  const { backups } = ensureLibraryDirs(getLibraryPath())
  if (!fs.existsSync(backups)) return []

  return fs
    .readdirSync(backups)
    .filter((f) => f.startsWith('journal-') && f.endsWith('.db'))
    .map((f) => {
      const fp = path.join(backups, f)
      const stat = fs.statSync(fp)
      return {
        name: f,
        timestamp: parseTimestampFromName(f) ?? stat.mtimeMs,
        size: stat.size,
      }
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function startAutoBackup(
  storage: LibraryStorage,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  maxBackups: number = DEFAULT_MAX_BACKUPS,
): void {
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
      storageRef.close()
      const result = createBackupFromDb()
      if (result) {
        const { backups } = ensureLibraryDirs(getLibraryPath())
        rotateBackups(backups, maxBackups)
      }
    }
  }
  app.on('before-quit', quitHandler)
}

function createBackupFromDb(): string | null {
  try {
    const { backups, dbFile } = ensureLibraryDirs(getLibraryPath())
    if (!fs.existsSync(dbFile)) return null

    const now = Date.now()
    const dest = path.join(backups, backupFileName(now))
    fs.copyFileSync(dbFile, dest)
    return dest
  } catch (err) {
    console.error('[backup] before-quit backup failed', err)
    return null
  }
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
    return true
  } catch {
    return false
  }
}
