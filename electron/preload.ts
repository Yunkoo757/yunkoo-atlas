import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateState } from '../src/lib/appUpdate'
import type { JournalBridge, StorageRecoveryRequiredState } from '../src/types/journalBridge'
import type { WindowsClosePreference } from '../src/types/journalBridge'
import { AsyncGeneration } from '../src/lib/asyncGeneration'

const closeFlushGeneration = new AsyncGeneration()
let storageWriterToken: string | null = null
let storageSnapshotRevision = 0

function requireStorageWriterToken(): string {
  if (!storageWriterToken) throw new Error('资料库写入会话尚未建立，请重新打开资料库')
  return storageWriterToken
}

export type {
  BackupInfo,
  BackupVerificationResult,
  JournalBridge,
  LibraryLocationState,
  StageRolloverCommitInput,
  StageRolloverCommitResult,
  StorageRecoveryRequiredState,
  StorageRecoveryResult,
  WindowFrameState,
  WindowsCloseChoice,
  WindowsClosePreference,
} from '../src/types/journalBridge'

const bridge: JournalBridge = {
  isElectron: true,
  platform: process.platform === 'win32' || process.platform === 'darwin'
    ? process.platform
    : 'other',
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
  onStorageRecoveryRequired: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: StorageRecoveryRequiredState) => {
      callback(state)
    }
    ipcRenderer.on('storage:recovery-required', listener)
    return () => ipcRenderer.removeListener('storage:recovery-required', listener)
  },
  onWindowsCloseExplanation: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:windows-close-explanation', listener)
    return () => ipcRenderer.removeListener('app:windows-close-explanation', listener)
  },
  onWindowsClosePreferenceError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('app:windows-close-preference-error', listener)
    return () => ipcRenderer.removeListener('app:windows-close-preference-error', listener)
  },
  resolveWindowsClose: (choice, remember) =>
    ipcRenderer.invoke('app:resolve-windows-close', { choice, remember }),
  getWindowsClosePreference: () => ipcRenderer.invoke('app:get-windows-close-preference'),
  setWindowsClosePreference: (preference: WindowsClosePreference) =>
    ipcRenderer.invoke('app:set-windows-close-preference', preference),
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
  storageOpen: async () => {
    const session = await ipcRenderer.invoke('storage:open') as { ok: boolean; writerToken: string; snapshotRevision: number }
    storageWriterToken = session.writerToken
    storageSnapshotRevision = session.snapshotRevision
    return session.ok
  },
  recoverStorage: () => ipcRenderer.invoke('storage:recover'),
  getManifest: () => ipcRenderer.invoke('storage:getManifest'),
  loadSnapshot: async () => {
    const result = await ipcRenderer.invoke('storage:loadSnapshot') as {
      snapshot: Awaited<ReturnType<JournalBridge['loadSnapshot']>>
      revision: number
    }
    storageSnapshotRevision = result.revision
    return result.snapshot
  },
  saveSnapshot: async (snapshot) => {
    const result = await ipcRenderer.invoke('storage:saveSnapshot', {
      snapshot,
      expectedRevision: storageSnapshotRevision,
      writerToken: requireStorageWriterToken(),
    }) as { revision: number }
    storageSnapshotRevision = result.revision
    return true
  },
  commitStageRollover: async (input) => {
    const result = await ipcRenderer.invoke('stage:commitRollover', {
      input,
      writerToken: requireStorageWriterToken(),
    })
    storageSnapshotRevision = await ipcRenderer.invoke('storage:getSnapshotRevision')
    return result
  },
  saveAsset: (data, mime) =>
    ipcRenderer.invoke('storage:saveAsset', { data, mime, writerToken: requireStorageWriterToken() }),
  getAssetBytes: (id) => ipcRenderer.invoke('storage:getAssetBytes', id),
  getAssetStats: (ids) => ipcRenderer.invoke('storage:getAssetStats', ids),
  listAssetRecords: () => ipcRenderer.invoke('storage:listAssetRecords'),
  previewAssetPurge: () => ipcRenderer.invoke('storage:previewAssetPurge'),
  prepareAssetPurgeRecovery: (preview) => ipcRenderer.invoke('storage:prepareAssetPurgeRecovery', {
    preview,
    writerToken: requireStorageWriterToken(),
  }),
  cancelAssetPurge: (operationId) => ipcRenderer.invoke('storage:cancelAssetPurge', {
    operationId,
    writerToken: requireStorageWriterToken(),
  }),
  commitAssetPurge: (preview, authorization) => ipcRenderer.invoke('storage:commitAssetPurge', {
    preview,
    authorization,
    writerToken: requireStorageWriterToken(),
  }),
  importAssets: (assets) => ipcRenderer.invoke('storage:importAssets', {
    assets,
    writerToken: requireStorageWriterToken(),
  }),
  commitImport: async (snapshot, assets, options) => {
    const result = await ipcRenderer.invoke('storage:commitImport', {
      snapshot,
      assets,
      options,
      expectedRevision: storageSnapshotRevision,
      writerToken: requireStorageWriterToken(),
    }) as { ok: boolean; revision: number }
    storageSnapshotRevision = result.revision
    return result.ok
  },
  exportJournalZip: () => ipcRenderer.invoke('journal:exportZip'),
  prepareJournalImport: (prepareRequestId) => ipcRenderer.invoke('journal:prepareImport', prepareRequestId),
  cancelPreparedJournalImport: (tokenOrRequestId) => ipcRenderer.invoke('journal:cancelPreparedImport', tokenOrRequestId),
  commitPreparedJournalImport: async (token) => {
    const result = await ipcRenderer.invoke('journal:commitPreparedImport', {
      token,
      writerToken: requireStorageWriterToken(),
    })
    if (result?.ok) storageSnapshotRevision = await ipcRenderer.invoke('storage:getSnapshotRevision')
    return result
  },
  createBackup: () => ipcRenderer.invoke('backup:create', requireStorageWriterToken()),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  verifyBackup: (fileName) => ipcRenderer.invoke('backup:verify', fileName),
  restoreBackup: async (fileName) => {
    const result = await ipcRenderer.invoke('backup:restore', {
      fileName,
      writerToken: requireStorageWriterToken(),
    })
    if (result?.ok) storageSnapshotRevision = await ipcRenderer.invoke('storage:getSnapshotRevision')
    return result
  },
  deleteBackup: (fileName) => ipcRenderer.invoke('backup:delete', {
    fileName,
    writerToken: requireStorageWriterToken(),
  }),
  getBackupStats: () => ipcRenderer.invoke('backup:stats'),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  applyWindowPreset: (presetId) => ipcRenderer.invoke('window:applyPreset', presetId),
  setWindowResizable: (resizable) => ipcRenderer.invoke('window:setResizable', resizable),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
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
