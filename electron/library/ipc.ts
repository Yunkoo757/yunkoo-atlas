import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import path from 'node:path'
import { LibraryStorage } from './storage'
import { exportJournalZip, importJournalZipToPath } from './journalZip'
import { getLibraryPath } from './paths'

let storage: LibraryStorage | null = null

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

export function registerLibraryIpc(): void {
  ipcMain.handle('library:getPath', async () => (await ensureStorage()).getLibraryPath())

  ipcMain.handle('storage:open', async () => {
    await ensureStorage()
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
    const result = await dialog.showSaveDialog(win ?? undefined, {
      title: '导出交易库',
      defaultPath: path.join(app.getPath('documents'), `linear-journal-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false as const }
    await exportJournalZip(await ensureStorage(), result.filePath)
    return { ok: true as const, path: result.filePath }
  })

  ipcMain.handle('journal:importZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '导入交易库',
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false as const }

    if (storage) storage.close()
    storage = null

    await importJournalZipToPath(getLibraryPath(), result.filePaths[0])

    const reopened = new LibraryStorage()
    await reopened.open()
    storage = reopened
    return { ok: true as const, snapshot: reopened.loadSnapshot() }
  })
}

export function resetStorageForTests(): void {
  if (storage) storage.close()
  storage = null
}
