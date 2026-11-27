import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateState } from '../src/lib/appUpdate'
import type { JournalBridge, StorageRecoveryRequiredState, TrayDestination, WindowsClosePreference } from '../src/types/journalBridge'
import { AsyncGeneration } from '../src/lib/asyncGeneration'
import { WindowWriterSessions, type WriterGrant } from './library/writerSession'

const closeFlushGeneration = new AsyncGeneration()
const writers = new WindowWriterSessions()
let pendingTrayDestination: TrayDestination | null = null
let trayNavigationListener: ((destination: TrayDestination) => void) | null = null

ipcRenderer.on('app:tray-navigate', (_event, destination: unknown) => {
  if (destination !== '/list' && destination !== '/dashboard' && destination !== '/settings') return
  if (trayNavigationListener) trayNavigationListener(destination)
  else pendingTrayDestination = destination
})

// 凭据和版本仅供预加载层使用，renderer 只收到公开结果。
function adoptSnapshotReceipt<T>(receipt: T & { writerGrant?: WriterGrant; revision?: number }, previous: { revision: number }): T {
  const { writerGrant, revision, ...result } = receipt
  if (writerGrant) writers.accept(writerGrant, revision ?? previous.revision)
  return result as T
}

const bridge: NonNullable<Window['journalBridge']> = {
  isElectron: true,
  copyCaseContent: (content) => ipcRenderer.invoke('case:copy-content', content),
  outputImage: (action, bytes) => ipcRenderer.invoke('image:output', action, bytes),
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
  onTrayNavigate: (callback) => {
    trayNavigationListener = callback
    if (pendingTrayDestination) {
      callback(pendingTrayDestination)
      pendingTrayDestination = null
    }
    return () => {
      if (trayNavigationListener === callback) trayNavigationListener = null
    }
  },
  resolveWindowsClose: (choice, remember) =>
    ipcRenderer.invoke('app:resolve-windows-close', { choice, remember }),
  getWindowsClosePreference: () => ipcRenderer.invoke('app:get-windows-close-preference'),
  setWindowsClosePreference: (preference: WindowsClosePreference) =>
    ipcRenderer.invoke('app:set-windows-close-preference', preference),
  getAutoLaunchState: () => ipcRenderer.invoke('app:get-auto-launch-state'),
  setAutoLaunchEnabled: (enabled) => ipcRenderer.invoke('app:set-auto-launch-enabled', enabled),
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
  activatePreparedLibrary: async (token) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('library:activatePrepared', token, session.token)
    return adoptSnapshotReceipt(result, session)
  },
  cancelPreparedLibrary: (token) => ipcRenderer.invoke('library:cancelPrepared', token),
  getLibraryPath: () => ipcRenderer.invoke('library:getPath'),
  storageOpen: async () => {
    const session = await ipcRenderer.invoke('storage:open') as { ok: boolean; writerGrant: WriterGrant; revision: number }
    writers.accept(session.writerGrant, session.revision)
    return session.ok
  },
  recoverStorage: () => ipcRenderer.invoke('storage:recover'),
  getSnapshotRevision: () => ipcRenderer.invoke('storage:getSnapshotRevision'),
  getManifest: () => ipcRenderer.invoke('storage:getManifest'),
  loadSnapshot: async () => {
    const session = writers.current
    const result = await ipcRenderer.invoke('storage:loadSnapshot') as {
      snapshot: Awaited<ReturnType<JournalBridge['loadSnapshot']>>
      revision: number
    }
    if (session !== writers.current) throw new Error('资料库已切换，请重新读取当前资料库')
    if (session) session.revision = result.revision
    return result.snapshot
  },
  saveSnapshot: async (snapshot) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('storage:saveSnapshot', {
      snapshot,
      expectedRevision: session.revision,
      writerToken: session.token,
    }) as { revision: number }
    session.revision = result.revision
    return true
  },
  commitStageRollover: async (input) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('stage:commitRollover', {
      input,
      writerToken: session.token,
    })
    if (!result.ok) return result
    if (session !== writers.current) return { ok: false, reason: 'stale', message: '资料库已切换，请重新读取当前阶段' }
    const { revisionBefore, revision, ...committed } = result
    // 阶段回包只含阶段字段。陈旧窗口必须先读取完整快照才能取得新的写入版本。
    if (session.revision === revisionBefore) session.revision = revision
    return committed
  },
  saveAsset: (data, mime) =>
    ipcRenderer.invoke('storage:saveAsset', { data, mime, writerToken: writers.require().token }),
  getAssetBytes: (id) => ipcRenderer.invoke('storage:getAssetBytes', id),
  getAssetStats: (ids) => ipcRenderer.invoke('storage:getAssetStats', ids),
  listAssetRecords: () => ipcRenderer.invoke('storage:listAssetRecords'),
  previewAssetPurge: () => ipcRenderer.invoke('storage:previewAssetPurge', writers.require().token),
  prepareAssetPurgeRecovery: (preview) => ipcRenderer.invoke('storage:prepareAssetPurgeRecovery', {
    preview,
    writerToken: writers.require().token,
  }),
  cancelAssetPurge: (operationId) => ipcRenderer.invoke('storage:cancelAssetPurge', {
    operationId,
    writerToken: writers.require().token,
  }),
  commitAssetPurge: async (preview, authorization) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('storage:commitAssetPurge', {
      preview,
      authorization,
      writerToken: session.token,
    })
    if (session.revision === preview.revision) session.revision = result.revision
    return result
  },
  importAssets: (assets) => ipcRenderer.invoke('storage:importAssets', {
    assets,
    writerToken: writers.require().token,
  }),
  commitImport: async (snapshot, assets, options) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('storage:commitImport', {
      snapshot,
      assets,
      options,
      expectedRevision: session.revision,
      writerToken: session.token,
    }) as { ok: boolean; revision: number }
    session.revision = result.revision
    return result.ok
  },
  exportJournalZip: () => ipcRenderer.invoke('journal:exportZip'),
  prepareJournalImport: (prepareRequestId) => ipcRenderer.invoke('journal:prepareImport', prepareRequestId),
  cancelPreparedJournalImport: (tokenOrRequestId) => ipcRenderer.invoke('journal:cancelPreparedImport', tokenOrRequestId),
  commitPreparedJournalImport: async (token) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('journal:commitPreparedImport', {
      token,
      writerToken: session.token,
    })
    return adoptSnapshotReceipt(result, session)
  },
  createBackup: () => ipcRenderer.invoke('backup:create', writers.require().token),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  verifyBackup: (fileName) => ipcRenderer.invoke('backup:verify', fileName),
  restoreBackup: async (fileName) => {
    const session = writers.require()
    const result = await ipcRenderer.invoke('backup:restore', {
      fileName,
      writerToken: session.token,
    })
    return adoptSnapshotReceipt(result, session)
  },
  deleteBackup: (fileName) => ipcRenderer.invoke('backup:delete', {
    fileName,
    writerToken: writers.require().token,
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
