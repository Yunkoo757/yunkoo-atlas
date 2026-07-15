import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Trade } from '../../src/data/trades'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import { collectAssetIdsFromNotes } from '../../src/storage/assets'
import type { PersistedSnapshot } from '../../src/storage/types'
import { runAssetSyncCycle, type AssetSyncRepository } from '../../src/sync/assetSync'
import { HttpMetadataSyncTransport } from '../../src/sync/httpTransport'
import { runMetadataSyncCycle, type MetadataSyncRepository } from '../../src/sync/metadataSync'
import { createAtlasSyncServer } from '../../server/sync-api/app.mjs'
import { LibraryStorage } from '../library/storage'
import { CloudSyncCoordinator } from './coordinator'
import type { CloudSyncRuntimeConfig } from './configFile'

const TOKEN = 'integration-token-with-enough-entropy'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function tradeWithAsset(assetId: string): Trade {
  return {
    id: 'trade-with-original',
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: '',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: null,
    exit: null,
    size: null,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-15',
    closedAt: null,
    note: `<p>原图</p><img src="journal-asset://${assetId}">`,
  }
}

function snapshot(trades: Trade[] = [], includeSettings = false): PersistedSnapshot {
  const base: PersistedSnapshot = {
    trades,
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: [],
    mistakeTagPresets: [],
  }
  if (!includeSettings) return base
  return {
    ...base,
    shortcuts: { 'global.search': { mod: true, key: 'k' } },
    tagPresets: ['伦敦开盘'],
    mistakeTagPresets: ['追单'],
    profile: { avatarId: 'cobalt', displayName: 'Yunkoo' },
    savedTradeViews: [{
      id: 'view-1', name: 'BTC 复盘', pathname: '/list', search: { symbol: 'BTCUSDT' },
      pinned: true, order: 0, createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    }],
    symbolIcons: { BTCUSDT: { presetId: 'btc', updatedAt: '2026-07-15T00:00:00.000Z' } },
    symbolCatalog: ['BTCUSDT', 'XAUUSD'],
  }
}

function metadataRepository(storage: LibraryStorage, remoteLibraryId: string): MetadataSyncRepository {
  return {
    getLocalSyncStatus: async () => ({
      ...storage.getLocalSyncStatus(),
      libraryId: remoteLibraryId,
    }),
    listPendingSyncOperations: async (limit) => storage.listPendingSyncOperations(limit),
    acknowledgeSyncOperations: async (ids, cursor) => storage.acknowledgeSyncOperations(ids, cursor),
    applyRemoteSyncOperations: async (operations, cursor) => (
      storage.applyRemoteSyncOperations(operations, cursor)
    ),
  }
}

function assetRepository(storage: LibraryStorage): AssetSyncRepository {
  return {
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
  }
}

function coordinator(
  storage: LibraryStorage,
  transport: HttpMetadataSyncTransport,
  remoteLibraryId: string,
): CloudSyncCoordinator {
  let config: CloudSyncRuntimeConfig = {
    enabled: false,
    baseUrl: 'http://127.0.0.1',
    libraryId: remoteLibraryId,
    localLibraryId: storage.readManifest().libraryId,
    token: TOKEN,
  }
  return new CloudSyncCoordinator({
    readConfig: () => config,
    setEnabled: (enabled) => { config = { ...config, enabled } },
    withLibrary: async (operation) => operation({
      ...metadataRepository(storage, storage.readManifest().libraryId),
      ...assetRepository(storage),
      prepareMetadataSyncBootstrap: async () => storage.prepareMetadataSyncBootstrap(),
      resetMetadataSyncEpoch: async (epoch) => storage.resetMetadataSyncEpoch(epoch),
      adoptRemoteMetadataEpoch: async (epoch, operations, cursor) => (
        storage.adoptRemoteMetadataEpoch(epoch, operations, cursor)
      ),
      getLocalAssetStatus: async () => {
        const ids = collectAssetIdsFromNotes(storage.loadSnapshot()?.trades ?? [])
        return { assetCount: ids.length, missingAssetCount: storage.getAssetStats(ids).missingCount }
      },
    }),
    createTransport: () => transport,
    broadcast: () => {},
  })
}

export async function testTwoDesktopLibrariesRoundTripMetadataAndOriginalAssetBytesOverHttp(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cloud-integration-'))
  const server = createAtlasSyncServer({
    databasePath: path.join(root, 'server-sync.db'),
    token: TOKEN,
  })
  const storageA = new LibraryStorage(path.join(root, 'device-a'))
  const storageB = new LibraryStorage(path.join(root, 'device-b'))
  try {
    await storageA.open()
    await storageB.open()
    storageA.saveSnapshot(snapshot([tradeWithAsset('asset-original')], true))
    storageB.saveSnapshot(snapshot())
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])
    storageA.importAsset('asset-original', 'image/png', original)

    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    const transport = new HttpMetadataSyncTransport({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: TOKEN,
    })
    const remoteLibraryId = 'library-http-integration'
    assert(await transport.registerLibrary(remoteLibraryId, 1), '测试云端资料库必须成功创建')

    storageA.prepareMetadataSyncBootstrap()
    await runMetadataSyncCycle(metadataRepository(storageA, remoteLibraryId), transport)
    const uploaded = await runAssetSyncCycle(
      assetRepository(storageA), transport, remoteLibraryId, 1,
    )
    await runMetadataSyncCycle(metadataRepository(storageB, remoteLibraryId), transport)
    const downloaded = await runAssetSyncCycle(
      assetRepository(storageB), transport, remoteLibraryId, 1,
    )

    assert(uploaded.uploadedCount === 1, '设备 A 必须上传被交易引用的原图')
    assert(storageB.loadSnapshot()?.trades[0]?.note.includes('asset-original'), '设备 B 必须先收到原图引用')
    assert(storageB.loadSnapshot()?.tagPresets?.[0] === '伦敦开盘', '标签设置必须跨设备同步')
    assert(storageB.loadSnapshot()?.shortcuts?.['global.search'] !== undefined, '快捷键设置必须跨设备同步')
    assert(storageB.loadSnapshot()?.profile?.displayName === 'Yunkoo', '个人资料必须跨设备同步')
    assert(storageB.loadSnapshot()?.savedTradeViews?.[0]?.id === 'view-1', '保存视图必须跨设备同步')
    assert(storageB.loadSnapshot()?.symbolCatalog?.[0] === 'BTCUSDT', '品种设置必须跨设备同步')
    assert(downloaded.downloadedCount === 1, '设备 B 必须把引用原图完整下载到离线库')
    assert(
      Buffer.from(storageB.getAssetBytes('asset-original')?.bytes ?? []).equals(original),
      '跨设备同步后的附件必须与设备 A 原始字节完全一致',
    )
  } finally {
    storageA.close()
    storageB.close()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testRestoredDeviceReplacesCloudAndOlderDeviceAdoptsTheNewEpoch(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cloud-epoch-integration-'))
  const server = createAtlasSyncServer({ databasePath: path.join(root, 'sync.db'), token: TOKEN })
  const storageA = new LibraryStorage(path.join(root, 'authority'))
  const storageB = new LibraryStorage(path.join(root, 'older-device'))
  try {
    await storageA.open()
    await storageB.open()
    const restored = snapshot([], true)
    restored.tagPresets = ['恢复后权威版本']
    storageA.saveSnapshot(restored)
    storageB.saveSnapshot(snapshot([tradeWithAsset('stale-asset')]))
    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    const transport = new HttpMetadataSyncTransport({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: TOKEN,
    })
    const remoteLibraryId = 'library-epoch-integration'
    await transport.registerLibrary(remoteLibraryId, 1)

    const replaced = await coordinator(storageA, transport, remoteLibraryId).setup('replace')
    const adopted = await coordinator(storageB, transport, remoteLibraryId).setup('connect')

    assert(replaced.state.phase === 'idle', '权威设备必须完成新 epoch 检查点后再恢复同步')
    assert(storageA.getLocalSyncStatus().epoch === 2, '权威设备必须进入新 epoch')
    assert(storageB.getLocalSyncStatus().epoch === 2, '旧设备必须采用云端新 epoch')
    assert(storageB.loadSnapshot()?.trades.length === 0, '旧设备的陈旧交易不得混入恢复后的权威资料库')
    assert(storageB.loadSnapshot()?.tagPresets?.[0] === '恢复后权威版本', '旧设备必须收到恢复后的完整设置')
    assert(adopted.authoritativeSnapshot?.tagPresets?.[0] === '恢复后权威版本', '渲染进程必须收到权威替换快照')
  } finally {
    storageA.close()
    storageB.close()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
