import { contextBridge, ipcRenderer } from 'electron'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '../src/storage/types'
import type { AppUpdateState } from '../src/lib/appUpdate'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
}

export interface JournalBridge {
  isElectron: true
  /** 注册主进程关闭前回调 */
  onBeforeClose(callback: () => void): void
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
  restoreBackup(fileName: string): Promise<PersistedSnapshot | null>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
  // 应用更新
  getUpdateState(): Promise<AppUpdateState>
  hasUpdateCredential(): Promise<boolean>
  saveUpdateCredential(token: string): Promise<boolean>
  clearUpdateCredential(): Promise<boolean>
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<boolean>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
}

const bridge: JournalBridge = {
  isElectron: true,
  onBeforeClose: (callback) => {
    ipcRenderer.on('app:before-close', () => callback())
  },
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
  getBackupStats: () => ipcRenderer.invoke('backup:stats'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  hasUpdateCredential: () => ipcRenderer.invoke('update:hasCredential'),
  saveUpdateCredential: (token) => ipcRenderer.invoke('update:saveCredential', token),
  clearUpdateCredential: () => ipcRenderer.invoke('update:clearCredential'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
}

contextBridge.exposeInMainWorld('journalBridge', bridge)
