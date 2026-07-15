import type { MetadataSyncRepository, MetadataSyncTransport } from '../../src/sync/metadataSync'
import type { LocalSyncStatus, RemoteSyncOperation, SyncOutboxOperation } from '../../src/sync/types'
import type { AssetSyncRepository, AssetSyncTransport } from '../../src/sync/assetSync'
import type { CloudSyncRuntimeConfig } from './configFile'
import { CloudSyncCoordinator } from './coordinator'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createHarness(remoteExists: boolean) {
  let config: CloudSyncRuntimeConfig | null = {
    enabled: false,
    baseUrl: 'https://atlas-sync.example.com',
    libraryId: 'cloud-library',
    localLibraryId: 'local-library',
    token: 'private-token',
  }
  let bootstrapCount = 0
  let pending: SyncOutboxOperation[] = []
  let registered = false
  let failNextPull = false
  let failNextPush = false
  let remoteEpoch = remoteExists ? 1 : null
  let resetEpoch: number | null = null
  let finalizedEpoch: number | null = null
  let adoptedEpoch: number | null = null
  const authoritativeSnapshot: PersistedSnapshot = {
    trades: [], strategies: [], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY, tagPresets: ['远端新 epoch'], mistakeTagPresets: [],
  }
  const status: LocalSyncStatus = {
    libraryId: 'local-library',
    deviceId: 'device-a',
    epoch: 1,
    deviceSeq: 0,
    pullCursor: null,
    lastSyncAt: null,
    pendingCount: 0,
    conflictCount: 0,
  }
  const repository: MetadataSyncRepository & AssetSyncRepository & {
    prepareMetadataSyncBootstrap(): Promise<number>
    resetMetadataSyncEpoch(nextEpoch: number): Promise<void>
    adoptRemoteMetadataEpoch(
      nextEpoch: number,
      operations: RemoteSyncOperation[],
      pullCursor: string,
    ): Promise<PersistedSnapshot>
    getLocalAssetStatus(): Promise<{ assetCount: number; missingAssetCount: number }>
  } = {
    getLocalSyncStatus: async () => ({ ...status, pendingCount: pending.length }),
    listPendingSyncOperations: async () => [...pending],
    acknowledgeSyncOperations: async (ids) => {
      pending = pending.filter((operation) => !ids.includes(operation.opId))
    },
    applyRemoteSyncOperations: async (_operations: RemoteSyncOperation[], cursor: string) => {
      status.pullCursor = cursor
      return { appliedCount: 0, conflictCount: 0 }
    },
    prepareMetadataSyncBootstrap: async () => {
      bootstrapCount += 1
      pending = [{
        opId: 'bootstrap-1', deviceId: 'device-a', deviceSeq: 1,
        entityType: 'workspace', entityId: 'tags', kind: 'upsert',
        baseRevision: 0, revision: 1, payload: { tagPresets: [] },
        createdAt: '2026-07-15T00:00:00.000Z', state: 'pending',
      }]
      return 1
    },
    listReferencedAssetIds: async () => [],
    getAsset: async () => null,
    importAsset: async () => {},
    getLocalAssetStatus: async () => ({ assetCount: 0, missingAssetCount: 0 }),
    resetMetadataSyncEpoch: async (nextEpoch) => {
      status.epoch = nextEpoch
      status.deviceSeq = 0
      status.pullCursor = null
      status.lastSyncAt = null
      pending = []
    },
    adoptRemoteMetadataEpoch: async (nextEpoch) => {
      adoptedEpoch = nextEpoch
      status.epoch = nextEpoch
      status.pullCursor = '1'
      return authoritativeSnapshot
    },
  }
  const transport: MetadataSyncTransport & {
    registerLibrary(libraryId: string, epoch: number): Promise<boolean>
    libraryExists(libraryId: string, epoch: number): Promise<boolean>
    getLibraryEpoch(libraryId: string): Promise<number | null>
    getLibraryState(libraryId: string): Promise<{ epoch: number; ready: boolean } | null>
    resetLibrary(libraryId: string, epoch: number, nextEpoch: number): Promise<void>
    finalizeLibrary(libraryId: string, epoch: number): Promise<void>
  } & AssetSyncTransport = {
    registerLibrary: async () => {
      registered = true
      remoteEpoch = status.epoch
      return true
    },
    libraryExists: async () => remoteExists,
    getLibraryEpoch: async () => remoteEpoch,
    getLibraryState: async () => remoteEpoch === null ? null : { epoch: remoteEpoch, ready: true },
    resetLibrary: async (_libraryId, _epoch, nextEpoch) => {
      remoteEpoch = nextEpoch
      resetEpoch = nextEpoch
    },
    finalizeLibrary: async (_libraryId, epoch) => { finalizedEpoch = epoch },
    push: async (request) => {
      if (failNextPush) {
        failNextPush = false
        throw new TypeError('fetch failed')
      }
      return { acknowledgedOperationIds: request.operations.map((operation) => operation.opId) }
    },
    pull: async (request) => {
      if (failNextPull) {
        failNextPull = false
        throw new TypeError('fetch failed')
      }
      if (remoteEpoch !== null && request.epoch !== remoteEpoch) {
        throw new Error('library epoch mismatch')
      }
      return {
        operations: [],
        nextCursor: request.afterCursor ?? '0',
        hasMore: false,
      }
    },
    listAssets: async () => [],
    uploadAsset: async () => {},
    downloadAsset: async () => { throw new Error('unexpected asset download') },
  }
  const coordinator = new CloudSyncCoordinator({
    readConfig: () => config,
    setEnabled: (enabled) => { if (config) config = { ...config, enabled } },
    withLibrary: async (operation) => operation(repository),
    createTransport: () => transport,
    broadcast: () => {},
  })
  return {
    coordinator,
    getConfig: () => config,
    getBootstrapCount: () => bootstrapCount,
    wasRegistered: () => registered,
    failNextPull: () => { failNextPull = true },
    failNextPush: () => { failNextPush = true },
    addPendingOperation: () => {
      pending = [{
        opId: 'local-2', deviceId: 'device-a', deviceSeq: 2,
        entityType: 'workspace', entityId: 'display', kind: 'upsert',
        baseRevision: 0, revision: 1, payload: { groupByDate: true },
        createdAt: '2026-07-15T01:00:00.000Z', state: 'pending',
      }]
    },
    switchLocalLibrary: () => { status.libraryId = 'different-local-library' },
    getResetEpoch: () => resetEpoch,
    getFinalizedEpoch: () => finalizedEpoch,
    getAdoptedEpoch: () => adoptedEpoch,
    setRemoteEpoch: (epoch: number) => { remoteEpoch = epoch },
  }
}

export async function testCreatingCloudLibraryBootstrapsOnceAndCompletesTheFirstSync(): Promise<void> {
  const harness = createHarness(false)
  const { state } = await harness.coordinator.setup('create')
  assert(harness.wasRegistered(), '新云端资料库必须先完成注册')
  assert(harness.getBootstrapCount() === 1, '只有创建云端资料库时才生成本机完整检查点')
  assert(harness.getFinalizedEpoch() === 1, '首轮元数据与附件上传完成后才允许云端资料库对其他设备可见')
  assert(harness.getConfig()?.enabled === true, '首次同步成功后才允许启用后台同步')
  assert(state.phase === 'idle' && state.pendingCount === 0, '首轮上传完成后必须进入已同步状态')
  assert(state.libraryId === 'cloud-library', '界面必须展示云端资料库 ID')
}

export async function testConnectingExistingCloudLibraryNeverUploadsAnEmptyBootstrap(): Promise<void> {
  const harness = createHarness(true)
  const { state } = await harness.coordinator.setup('connect')
  assert(!harness.wasRegistered(), '连接已有资料库不得调用创建端点')
  assert(harness.getBootstrapCount() === 0, '新设备不得把本机空库作为检查点上传')
  assert(harness.getConfig()?.enabled === true, '连接并拉取成功后必须启用后台同步')
  assert(state.phase === 'idle', '连接完成后必须进入可继续工作的状态')
}

export async function testOfflineStateSurvivesSettingsRefreshUntilTheNextSuccessfulSync(): Promise<void> {
  const harness = createHarness(false)
  await harness.coordinator.setup('create')
  harness.addPendingOperation()
  harness.failNextPush()
  const failed = await harness.coordinator.runNow()
  assert(failed.state.phase === 'offline', '网络失败必须明确进入离线状态')
  assert(failed.state.pendingCount === 1, '离线状态必须保留真实待上传数量')
  const refreshed = await harness.coordinator.getState()
  assert(refreshed.phase === 'offline', '重新读取状态不得把离线误报为已同步')
  assert(refreshed.message?.includes('fetch failed'), '离线状态必须保留可诊断信息')
}

export async function testCloudSyncNeverRunsAgainstADifferentLocalLibrary(): Promise<void> {
  const harness = createHarness(false)
  await harness.coordinator.setup('create')
  harness.switchLocalLibrary()
  const result = await harness.coordinator.runNow()
  assert(result.state.phase === 'error', '切换资料库后必须阻止旧云端连接继续同步')
  assert(result.state.message?.includes('另一个本地资料库'), '错误必须说明连接归属而不是泛化为网络失败')
}

export async function testLibraryRecoveryPausesAutomaticSyncBeforeCloudCanOverwriteIt(): Promise<void> {
  const harness = createHarness(false)
  await harness.coordinator.setup('create')
  const paused = harness.coordinator.pause('已恢复本地备份，自动同步已暂停')
  assert(paused.phase === 'disabled' && !harness.getConfig()?.enabled, '恢复后必须立即持久化暂停状态')
  assert(paused.message?.includes('恢复'), '设置页必须解释自动暂停原因')
}

export async function testRestoredLibraryCanExplicitlyReplaceCloudWithANewEpoch(): Promise<void> {
  const harness = createHarness(true)
  const result = await harness.coordinator.setup('replace')
  assert(harness.getResetEpoch() === 2, '以本机重建云端必须推进服务端 epoch')
  assert(harness.getFinalizedEpoch() === 2, '完整检查点与附件上传后才允许标记新 epoch 就绪')
  assert(harness.getBootstrapCount() === 1, '新 epoch 必须上传恢复后资料库的完整检查点')
  assert(result.state.phase === 'idle' && harness.getConfig()?.enabled === true, '重建完整成功后才恢复自动同步')
}

export async function testOlderDeviceAdoptsAReadyRemoteEpochAsAnAuthoritativeSnapshot(): Promise<void> {
  const harness = createHarness(true)
  harness.setRemoteEpoch(2)
  const result = await harness.coordinator.setup('connect')
  assert(harness.getAdoptedEpoch() === 2, '旧设备必须采用云端权威新 epoch，而不是继续旧历史')
  assert(result.authoritativeSnapshot?.tagPresets?.[0] === '远端新 epoch', '渲染进程必须收到完整替换快照')
}

export async function testBackgroundSyncPausesWhenAnotherDeviceRebuildsCloud(): Promise<void> {
  const harness = createHarness(false)
  await harness.coordinator.setup('create')
  harness.setRemoteEpoch(2)
  const result = await harness.coordinator.runNow()
  assert(result.state.phase === 'error' && result.state.enabled === false, '发现新 epoch 后必须停止重复后台失败')
  assert(harness.getConfig()?.enabled === false, '暂停状态必须持久化到当前设备')
  assert(result.state.message?.includes('连接已有资料库'), '界面必须给出可恢复的下一步')
}
