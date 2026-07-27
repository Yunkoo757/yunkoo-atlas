import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateState } from '../src/lib/appUpdate'
import type { JournalBridge } from '../src/types/journalBridge'
import { AsyncGeneration } from '../src/lib/asyncGeneration'

const closeFlushGeneration = new AsyncGeneration()

export type {
  BackupInfo,
  BackupVerificationResult,
  JournalBridge,
  LibraryLocationState,
  WindowFrameState,
} from '../src/types/journalBridge'

const bridge: JournalBridge = {
  isElectron: true,
  onBeforeClose: (callback) => {
    const listener = async (
      _event: Electron.IpcRendererEvent,
      request?: { requestId?: string; webContentsId?: number },
    ) => {
      if (!request?.requestId || typeof request.webContentsId !== 'number') return
      const generation = closeFlushGeneration.begin()
      try {
        await callback()
        if (!closeFlushGeneration.isCurrent(generation)) return
        ipcRenderer.send('app:before-close-complete', { ...request, ok: true })
      } catch (error) {
        if (!closeFlushGeneration.isCurrent(generation)) return
        ipcRenderer.send('app:before-close-complete', {
          ...request,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    ipcRenderer.on('app:before-close', listener)
    return () => ipcRenderer.removeListener('app:before-close', listener)
  },
  onCloseSaveError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => {
      closeFlushGeneration.invalidate()
      callback(message)
    }
    ipcRenderer.on('app:close-save-error', listener)
    return () => ipcRenderer.removeListener('app:close-save-error', listener)
  },
  onAutoBackupFailure: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('backup:auto-failed', listener)
    return () => ipcRenderer.removeListener('backup:auto-failed', listener)
  },
  requestClose: () => ipcRenderer.invoke('app:request-close'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  getWindowHotkey: () => ipcRenderer.invoke('window-hotkey:get'),
  setWindowHotkey: (binding) => ipcRenderer.invoke('window-hotkey:set', binding),
  resetWindowHotkey: () => ipcRenderer.invoke('window-hotkey:reset'),
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
  listAssetRecords: () => ipcRenderer.invoke('storage:listAssetRecords'),
  previewAssetPurge: () => ipcRenderer.invoke('storage:previewAssetPurge'),
  prepareAssetPurgeRecovery: (preview) => ipcRenderer.invoke('storage:prepareAssetPurgeRecovery', preview),
  cancelAssetPurge: (operationId) => ipcRenderer.invoke('storage:cancelAssetPurge', operationId),
  commitAssetPurge: (preview, authorization) => ipcRenderer.invoke('storage:commitAssetPurge', { preview, authorization }),
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
