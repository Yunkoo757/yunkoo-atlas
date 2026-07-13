import { ipcMain, dialog, BrowserWindow, app, type OpenDialogOptions } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { LibraryStorage } from './storage'
import { exportJournalZip, importJournalZipToPath } from './journalZip'
import { getLibraryPath, saveLibraryConfig, ensureLibraryDirs } from './paths'
import { createBackup, listBackups, restoreBackup, deleteBackup, startAutoBackup, stopAutoBackup, getBackupStats, rotateBackups } from './backup'

let storage: LibraryStorage | null = null
let autoBackupStarted = false

async function ensureStorage(): Promise<LibraryStorage> {
  if (!storage) {
    storage = new LibraryStorage()
    await storage.open()
  }
  return storage
}

function bufferFromPayload(data: ArrayBuffer | Uint8Array | number[]): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(data)
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function reopenStorageWithAutoBackup(): Promise<LibraryStorage> {
  const reopened = new LibraryStorage()
  await reopened.open()
  storage = reopened
  startAutoBackup(reopened)
  autoBackupStarted = true
  return reopened
}

async function switchActiveLibrary(
  libPath: string,
  mode: 'create' | 'open',
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!libPath.trim()) return { ok: false, error: '请选择有效的交易库目录' }
  const resolvedPath = path.resolve(libPath)
  const manifestFile = path.join(resolvedPath, 'manifest.json')
  const dbFile = path.join(resolvedPath, 'journal.db')

  if (mode === 'create' && (fs.existsSync(manifestFile) || fs.existsSync(dbFile))) {
    return { ok: false, error: '所选目录已经包含交易库，请改用“打开现有库”' }
  }
  if (mode === 'open' && !fs.existsSync(manifestFile)) {
    return { ok: false, error: '所选目录中没有找到交易库 (manifest.json)' }
  }

  const candidate = new LibraryStorage(resolvedPath)
  try {
    await candidate.open()
  } catch (err) {
    candidate.release()
    return { ok: false, error: toErrorMessage(err) }
  }

  try {
    // 先完整验证候选库，再改配置和关闭当前库；失败时当前工作区保持可用。
    saveLibraryConfig({ libraryPath: resolvedPath })
  } catch (err) {
    candidate.release()
    return { ok: false, error: `无法保存交易库位置：${toErrorMessage(err)}` }
  }

  stopAutoBackup()
  storage?.close()
  storage = candidate
  startAutoBackup(candidate)
  autoBackupStarted = true
  return { ok: true }
}

export function registerLibraryIpc(): void {
  // ---- 库路径引导 ----
  ipcMain.handle('library:getStatus', async () => {
    const libPath = getLibraryPath()
    const manifestFile = path.join(libPath, 'manifest.json')
    const initialized = (() => {
      try { return fs.existsSync(manifestFile) } catch { return false }
    })()
    return { initialized, path: libPath }
  })

  ipcMain.handle('library:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '选择交易库目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:createNew', async (_e, libPath: string) => {
    return switchActiveLibrary(libPath, 'create')
  })

  ipcMain.handle('library:openExisting', async (_e, libPath: string) => {
    return switchActiveLibrary(libPath, 'open')
  })

  // ---- 常规 storage IPC ----
  ipcMain.handle('library:getPath', async () => (await ensureStorage()).getLibraryPath())

  ipcMain.handle('storage:open', async () => {
    await ensureStorage()
    // 首次打开时启动自动备份（幂等防护）
    if (!autoBackupStarted && storage) {
      startAutoBackup(storage)
      autoBackupStarted = true
    }
    return true
  })

  ipcMain.handle('storage:getManifest', async () => (await ensureStorage()).readManifest())

  ipcMain.handle('storage:loadSnapshot', async () => (await ensureStorage()).loadSnapshot())

  ipcMain.handle('storage:saveSnapshot', async (_e, snapshot) => {
    ;(await ensureStorage()).saveSnapshot(snapshot)
    return true
  })

  ipcMain.handle('storage:saveAsset', async (_e, payload: { data: ArrayBuffer; mime: string }) => {
    const id = await (await ensureStorage()).saveAssetAsync(
      bufferFromPayload(payload.data),
      payload.mime,
    )
    return id
  })

  ipcMain.handle('storage:getAssetBytes', async (_e, id: string) => {
    return (await ensureStorage()).getAssetBytes(id)
  })

  ipcMain.handle('storage:importAssets', async (_e, assets: { id: string; mime: string; data: string }[]) => {
    const lib = await ensureStorage()
    for (const a of assets) {
      const bin = Buffer.from(a.data, 'base64')
      lib.importAsset(a.id, a.mime, bin)
    }
    return true
  })

  ipcMain.handle('journal:exportZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const date = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出交易库',
      defaultPath: path.join(app.getPath('documents'), `linear-journal-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const }
    await exportJournalZip(await ensureStorage(), result.filePath)
    return { ok: true as const, path: result.filePath }
  })

  // ---- 备份 ----
  ipcMain.handle('backup:create', async () => {
    const result = createBackup(await ensureStorage())
    if (result) rotateBackups(ensureLibraryDirs(getLibraryPath()).backups)
    return result
  })

  ipcMain.handle('backup:list', async () => listBackups())

  ipcMain.handle('backup:restore', async (_e, fileName: string) => {
    const current = await ensureStorage()
    // 在覆盖资料库前创建一个包含原图的完整恢复点。
    if (!createBackup(current)) return false
    stopAutoBackup()
    autoBackupStarted = false
    current.close()
    storage = null

    const ok = restoreBackup(fileName)
    // 无论恢复是否成功，都重新打开资料库并重建自动备份计时器。
    const reopened = await reopenStorageWithAutoBackup()
    return ok ? reopened.loadSnapshot() : false
  })

  ipcMain.handle('backup:delete', async (_e, fileName: string) => {
    return deleteBackup(fileName)
  })

  ipcMain.handle('backup:stats', async () => getBackupStats())

  // 启动自动备份（15 分钟 + 退出前）
  ipcMain.handle('backup:startAuto', async () => {
    startAutoBackup(await ensureStorage())
    return true
  })

  ipcMain.handle('journal:importZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '导入交易库',
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
      properties: ['openFile'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false as const, canceled: true as const }
    }

    stopAutoBackup()
    if (storage) storage.close()
    storage = null

    try {
      await importJournalZipToPath(getLibraryPath(), result.filePaths[0])
    } catch (err) {
      console.error('[journal:importZip] import failed', err)
      const message = toErrorMessage(err)
      try {
        await reopenStorageWithAutoBackup()
      } catch (reopenErr) {
        console.error('[journal:importZip] reopen failed after import error', reopenErr)
        return {
          ok: false as const,
          error: `${message}; failed to reopen current library: ${toErrorMessage(reopenErr)}`,
        }
      }
      return { ok: false as const, error: message }
    }

    const reopened = await reopenStorageWithAutoBackup()
    return { ok: true as const, snapshot: reopened.loadSnapshot() }
  })
}

export function resetStorageForTests(): void {
  if (storage) storage.close()
  storage = null
}
