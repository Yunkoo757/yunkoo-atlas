import { contextBridge, ipcRenderer } from 'electron'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '../src/storage/types'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
}

export interface JournalBridge {
  isElectron: true
  // 库路径引导
  getLibraryStatus(): Promise<{ initialized: boolean; path: string }>
  pickLibraryFolder(): Promise<string | null>
  createNewLibrary(libPath: string): Promise<{ ok: boolean }>
  openExistingLibrary(libPath: string): Promise<{ ok: boolean; error?: string }>
  // 存储
  getLibraryPath(): Promise<string>
  storageOpen(): Promise<boolean>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  saveAsset(data: ArrayBuffer, mime: string): Promise<string>
  getAssetBytes(id: string): Promise<{ id: string; mime: string; bytes: Uint8Array } | null>
  importAssets(assets: ExportAssetRecord[]): Promise<boolean>
  exportJournalZip(): Promise<{ ok: true; path: string } | { ok: false }>
  importJournalZip(): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false }
  >
  // 备份
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(fileName: string): Promise<boolean>
  deleteBackup(fileName: string): Promise<boolean>
}

const bridge: JournalBridge = {
  isElectron: true,
  getLibraryStatus: () => ipcRenderer.invoke('library:getStatus'),
  pickLibraryFolder: () => ipcRenderer.invoke('library:pickFolder'),
  createNewLibrary: (libPath) => ipcRenderer.invoke('library:createNew', libPath),
  openExistingLibrary: (libPath) => ipcRenderer.invoke('library:openExisting', libPath),
  getLibraryPath: () => ipcRenderer.invoke('library:getPath'),
  storageOpen: () => ipcRenderer.invoke('storage:open'),
  getManifest: () => ipcRenderer.invoke('storage:getManifest'),
  loadSnapshot: () => ipcRenderer.invoke('storage:loadSnapshot'),
  saveSnapshot: (snapshot) => ipcRenderer.invoke('storage:saveSnapshot', snapshot),
  saveAsset: (data, mime) =>
    ipcRenderer.invoke('storage:saveAsset', { data, mime }),
  getAssetBytes: (id) => ipcRenderer.invoke('storage:getAssetBytes', id),
  importAssets: (assets) => ipcRenderer.invoke('storage:importAssets', assets),
  exportJournalZip: () => ipcRenderer.invoke('journal:exportZip'),
  importJournalZip: () => ipcRenderer.invoke('journal:importZip'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (fileName) => ipcRenderer.invoke('backup:restore', fileName),
  deleteBackup: (fileName) => ipcRenderer.invoke('backup:delete', fileName),
}

contextBridge.exposeInMainWorld('journalBridge', bridge)
