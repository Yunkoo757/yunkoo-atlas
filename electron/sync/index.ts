import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage } from 'electron'
import path from 'node:path'
import type { SaveCloudSyncConfigInput, CloudSyncSetupMode } from '../../src/sync/cloudSync'
import { HttpMetadataSyncTransport } from '../../src/sync/httpTransport'
import type { MetadataSyncRepository } from '../../src/sync/metadataSync'
import type { AssetSyncRepository } from '../../src/sync/assetSync'
import { collectAssetIdsFromNotes } from '../../src/storage/assets'
import { withActiveLibraryStorage } from '../library/ipc'
import {
  setLibraryIdentityChangeHandler,
  type LibraryIdentityChangeReason,
} from '../library/changeHooks'
import {
  clearCloudSyncConfig,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  type CloudSyncRuntimeConfig,
} from './configFile'
import { CloudSyncCoordinator } from './coordinator'

const CONFIG_FILE = 'cloud-sync.json'
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

let interval: ReturnType<typeof setInterval> | null = null
let registered = false

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全加密云同步令牌')
  }
}

const cipher = {
  encrypt(plainText: string): Buffer {
    assertEncryptionAvailable()
    return safeStorage.encryptString(plainText)
  },
  decrypt(encrypted: Buffer): string {
    assertEncryptionAvailable()
    return safeStorage.decryptString(encrypted)
  },
}

function readConfig(): CloudSyncRuntimeConfig | null {
  try {
    return loadCloudSyncConfig(configPath(), cipher)
  } catch {
    return null
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

const coordinator = new CloudSyncCoordinator({
  readConfig,
  setEnabled(enabled) {
    const current = readConfig()
    if (!current) throw new Error('云同步配置不存在')
    saveCloudSyncConfig(configPath(), cipher, { ...current, enabled })
  },
  withLibrary: async (operation) => withActiveLibraryStorage(async (storage) => {
    const repository: MetadataSyncRepository & AssetSyncRepository & {
      prepareMetadataSyncBootstrap(): Promise<number>
      resetMetadataSyncEpoch(nextEpoch: number): Promise<void>
      adoptRemoteMetadataEpoch(
        nextEpoch: number,
        operations: import('../../src/sync/types').RemoteSyncOperation[],
        pullCursor: string,
      ): Promise<import('../../src/storage/types').PersistedSnapshot>
      getLocalAssetStatus(): Promise<{ assetCount: number; missingAssetCount: number }>
    } = {
      getLocalSyncStatus: async () => storage.getLocalSyncStatus(),
      listPendingSyncOperations: async (limit) => storage.listPendingSyncOperations(limit),
      acknowledgeSyncOperations: async (ids, cursor) => storage.acknowledgeSyncOperations(ids, cursor),
      applyRemoteSyncOperations: async (operations, cursor) => (
        storage.applyRemoteSyncOperations(operations, cursor)
      ),
      prepareMetadataSyncBootstrap: async () => storage.prepareMetadataSyncBootstrap(),
      resetMetadataSyncEpoch: async (nextEpoch) => storage.resetMetadataSyncEpoch(nextEpoch),
      adoptRemoteMetadataEpoch: async (nextEpoch, operations, pullCursor) => (
        storage.adoptRemoteMetadataEpoch(nextEpoch, operations, pullCursor)
      ),
      listReferencedAssetIds: async () => (
        collectAssetIdsFromNotes(storage.loadSnapshot()?.trades ?? [])
      ),
      getAsset: async (id) => {
        const asset = storage.getAssetBytes(id)
        return asset ? { id: asset.id, mime: asset.mime, bytes: asset.bytes } : null
      },
      importAsset: async (asset) => {
        storage.importAsset(asset.id, asset.mime, Buffer.from(asset.bytes))
      },
      getLocalAssetStatus: async () => {
        const ids = collectAssetIdsFromNotes(storage.loadSnapshot()?.trades ?? [])
        const stats = storage.getAssetStats(ids)
        return { assetCount: ids.length, missingAssetCount: stats.missingCount }
      },
    }
    return operation(repository)
  }),
  createTransport: (config) => new HttpMetadataSyncTransport({
    baseUrl: config.baseUrl,
    token: config.token,
  }),
  broadcast: (state) => broadcast('sync:state', state),
})

function stopSchedule(): void {
  if (interval) clearInterval(interval)
  interval = null
}

function requestScheduledSync(): void {
  if (!readConfig()?.enabled) return
  broadcast('sync:request', null)
}

function startSchedule(requestImmediately = true): void {
  stopSchedule()
  const config = readConfig()
  if (!config?.enabled) return
  if (requestImmediately) requestScheduledSync()
  interval = setInterval(requestScheduledSync, AUTO_SYNC_INTERVAL_MS)
}

function libraryChangeMessage(reason: LibraryIdentityChangeReason): string {
  if (reason === 'restore') {
    return '已恢复本地备份，自动同步已暂停，避免云端新版本立即覆盖恢复结果'
  }
  if (reason === 'import') {
    return '已导入完整交易库，旧云同步连接已暂停，请确认当前资料库后重新配置'
  }
  return '已切换本地资料库，旧云同步连接已暂停，请为当前资料库重新配置'
}

async function saveConfig(input: SaveCloudSyncConfigInput) {
  assertEncryptionAvailable()
  const previous = readConfig()
  const token = input.token?.trim() || previous?.token || ''
  new HttpMetadataSyncTransport({ baseUrl: input.baseUrl, token })
  const localLibraryId = await withActiveLibraryStorage(async (storage) => (
    storage.readManifest().libraryId
  ))
  saveCloudSyncConfig(configPath(), cipher, {
    enabled: false,
    baseUrl: input.baseUrl,
    libraryId: input.libraryId,
    localLibraryId,
    token: input.token,
  })
  stopSchedule()
  return coordinator.getState()
}

export function registerCloudSync(): void {
  if (registered) return
  registered = true
  setLibraryIdentityChangeHandler((reason) => {
    stopSchedule()
    coordinator.pause(libraryChangeMessage(reason))
  })
  ipcMain.handle('sync:getState', () => coordinator.getState())
  ipcMain.handle('sync:saveConfig', (_event, input: SaveCloudSyncConfigInput) => saveConfig(input))
  ipcMain.handle('sync:clearConfig', async () => {
    stopSchedule()
    clearCloudSyncConfig(configPath())
    return coordinator.getState()
  })
  ipcMain.handle('sync:setup', async (_event, mode: CloudSyncSetupMode) => {
    const state = await coordinator.setup(mode)
    startSchedule(false)
    return state
  })
  ipcMain.handle('sync:runNow', () => coordinator.runNow())
  ipcMain.handle('sync:start', async () => {
    startSchedule()
    return coordinator.getState()
  })
  powerMonitor.on('resume', requestScheduledSync)
  app.on('before-quit', stopSchedule)
}
