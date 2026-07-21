import { contextBridge, ipcRenderer } from 'electron'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '../src/storage/types'
import type { AppUpdateState } from '../src/lib/appUpdate'
import type { WindowSizePresetId } from '../src/lib/windowBounds'
import type { WindowFrameState } from '../src/types/journal-bridge'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
  verification?: BackupVerificationResult
}

export interface BackupVerificationResult {
  status: 'verified' | 'invalid'
  checkedAt: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
  error?: string
}

export interface JournalBridge {
  isElectron: true
  /** 注册主进程关闭前回调；返回取消订阅函数 */
  onBeforeClose(callback: () => void | Promise<void>): () => void
  onCloseSaveError(callback: (message: string) => void): () => void
  requestClose(): Promise<void>
  toggleFullscreen(): Promise<boolean>
  // 库路径引导
  getLibraryStatus(): Promise<{ initialized: boolean; path: string }>
  pickLibraryFolder(): Promise<string | null>
  createNewLibrary(libPath: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  openExistingLibrary(libPath: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  prepareLibrarySwitch(libPath: string, mode: 'create' | 'open'): Promise<
    { ok: true; token: string } | { ok: false; error?: string }
  >
  activatePreparedLibrary(token: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  cancelPreparedLibrary(token: string): Promise<boolean>
  // 存储
  getLibraryPath(): Promise<string>
  storageOpen(): Promise<boolean>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  saveAsset(data: ArrayBuffer, mime: string): Promise<string>
  getAssetBytes(id: string): Promise<{ id: string; mime: string; bytes: Uint8Array } | null>
  getAssetStats(ids: string[]): Promise<{ count: number; totalBytes: number; missingCount: number }>
  importAssets(assets: ExportAssetRecord[]): Promise<boolean>
  commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<boolean>
  exportJournalZip(): Promise<{ ok: true; path: string } | { ok: false }>
  importJournalZip(): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false }
  >
  // 备份
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  verifyBackup(fileName: string): Promise<BackupVerificationResult>
  restoreBackup(fileName: string): Promise<PersistedSnapshot | null>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
  // 窗口
  getWindowState(): Promise<WindowFrameState | null>
  applyWindowPreset(
    presetId: WindowSizePresetId,
  ): Promise<{ ok: true; state: WindowFrameState } | { ok: false; error: string }>
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
    const listener = async () => {
      try {
        await callback()
        ipcRenderer.send('app:before-close-complete', { ok: true })
      } catch (error) {
        ipcRenderer.send('app:before-close-complete', {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    ipcRenderer.on('app:before-close', listener)
    return () => ipcRenderer.removeListener('app:before-close', listener)
  },
  onCloseSaveError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('app:close-save-error', listener)
    return () => ipcRenderer.removeListener('app:close-save-error', listener)
  },
  requestClose: () => ipcRenderer.invoke('app:request-close'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  getLibraryStatus: () => ipcRenderer.invoke('library:getStatus'),
  pickLibraryFolder: () => ipcRenderer.invoke('library:pickFolder'),
  createNewLibrary: (libPath) => ipcRenderer.invoke('library:createNew', libPath),
  openExistingLibrary: (libPath) => ipcRenderer.invoke('library:openExisting', libPath),
  prepareLibrarySwitch: (libPath, mode) => ipcRenderer.invoke('library:prepareSwitch', { libPath, mode }),
  activatePreparedLibrary: (token) => ipcRenderer.invoke('library:activatePrepared', token),
  cancelPreparedLibrary: (token) => ipcRenderer.invoke('library:cancelPrepared', token),
  getLibraryPath: () => ipcRenderer.invoke('library:getPath'),
  storageOpen: () => ipcRenderer.invoke('storage:open'),
  getManifest: () => ipcRenderer.invoke('storage:getManifest'),
  loadSnapshot: () => ipcRenderer.invoke('storage:loadSnapshot'),
  saveSnapshot: (snapshot) => ipcRenderer.invoke('storage:saveSnapshot', snapshot),
  saveAsset: (data, mime) =>
    ipcRenderer.invoke('storage:saveAsset', { data, mime }),
  getAssetBytes: (id) => ipcRenderer.invoke('storage:getAssetBytes', id),
  getAssetStats: (ids) => ipcRenderer.invoke('storage:getAssetStats', ids),
  importAssets: (assets) => ipcRenderer.invoke('storage:importAssets', assets),
  commitImport: (snapshot, assets, options) => ipcRenderer.invoke('storage:commitImport', { snapshot, assets, options }),
  exportJournalZip: () => ipcRenderer.invoke('journal:exportZip'),
  importJournalZip: () => ipcRenderer.invoke('journal:importZip'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  verifyBackup: (fileName) => ipcRenderer.invoke('backup:verify', fileName),
  restoreBackup: (fileName) => ipcRenderer.invoke('backup:restore', fileName),
  deleteBackup: (fileName) => ipcRenderer.invoke('backup:delete', fileName),
  getBackupStats: () => ipcRenderer.invoke('backup:stats'),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  applyWindowPreset: (presetId) => ipcRenderer.invoke('window:applyPreset', presetId),
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
