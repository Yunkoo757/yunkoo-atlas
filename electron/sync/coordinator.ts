import {
  runMetadataSyncCycle,
  type MetadataSyncRepository,
  type MetadataSyncTransport,
} from '../../src/sync/metadataSync'
import type {
  CloudSyncExecution,
  CloudSyncSetupMode,
  CloudSyncState,
} from '../../src/sync/cloudSync'
import {
  runAssetSyncCycle,
  type AssetSyncRepository,
  type AssetSyncTransport,
} from '../../src/sync/assetSync'
import type { CloudSyncRuntimeConfig } from './configFile'
import type { PersistedSnapshot } from '../../src/storage/types'
import type { RemoteSyncOperation } from '../../src/sync/types'

interface CloudSyncLibraryRepository extends MetadataSyncRepository, AssetSyncRepository {
  prepareMetadataSyncBootstrap(): Promise<number>
  resetMetadataSyncEpoch(nextEpoch: number): Promise<void>
  adoptRemoteMetadataEpoch(
    nextEpoch: number,
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): Promise<PersistedSnapshot>
  getLocalAssetStatus(): Promise<{ assetCount: number; missingAssetCount: number }>
}

interface CloudSyncTransport extends MetadataSyncTransport, AssetSyncTransport {
  registerLibrary(libraryId: string, epoch: number): Promise<boolean>
  libraryExists(libraryId: string, epoch: number): Promise<boolean>
  getLibraryEpoch(libraryId: string): Promise<number | null>
  getLibraryState(libraryId: string): Promise<{ epoch: number; ready: boolean } | null>
  resetLibrary(libraryId: string, epoch: number, nextEpoch: number): Promise<void>
  finalizeLibrary(libraryId: string, epoch: number): Promise<void>
}

interface CloudSyncCoordinatorDependencies {
  readConfig(): CloudSyncRuntimeConfig | null
  setEnabled(enabled: boolean): void
  withLibrary<T>(operation: (repository: CloudSyncLibraryRepository) => Promise<T>): Promise<T>
  createTransport(config: CloudSyncRuntimeConfig): CloudSyncTransport
  broadcast(state: CloudSyncState): void
}

function publicState(
  config: CloudSyncRuntimeConfig | null,
  input?: Partial<CloudSyncState>,
): CloudSyncState {
  return {
    enabled: config?.enabled ?? false,
    baseUrl: config?.baseUrl ?? '',
    libraryId: config?.libraryId ?? '',
    hasToken: Boolean(config?.token),
    phase: config?.enabled ? 'idle' : 'disabled',
    lastSyncAt: null,
    pendingCount: 0,
    conflictCount: 0,
    assetCount: 0,
    missingAssetCount: 0,
    message: null,
    ...input,
  }
}

function remoteRepository(
  repository: CloudSyncLibraryRepository,
  remoteLibraryId: string,
): MetadataSyncRepository {
  return {
    getLocalSyncStatus: async () => ({
      ...await repository.getLocalSyncStatus(),
      libraryId: remoteLibraryId,
    }),
    listPendingSyncOperations: (limit) => repository.listPendingSyncOperations(limit),
    acknowledgeSyncOperations: (operationIds, pullCursor) => (
      repository.acknowledgeSyncOperations(operationIds, pullCursor)
    ),
    applyRemoteSyncOperations: (operations, pullCursor) => (
      repository.applyRemoteSyncOperations(operations, pullCursor)
    ),
  }
}

async function downloadRemoteEpoch(
  transport: MetadataSyncTransport,
  libraryId: string,
  epoch: number,
  deviceId: string,
): Promise<{ operations: RemoteSyncOperation[]; pullCursor: string }> {
  const operations: RemoteSyncOperation[] = []
  let cursor: string | null = null
  for (let page = 0; page < 100; page += 1) {
    const result = await transport.pull({
      libraryId,
      epoch,
      deviceId,
      afterCursor: cursor,
      limit: 500,
    })
    if (result.hasMore && result.nextCursor === cursor) {
      throw new Error('远端新版本游标未推进，已停止资料库替换')
    }
    operations.push(...result.operations)
    cursor = result.nextCursor
    if (!result.hasMore) return { operations, pullCursor: cursor }
  }
  throw new Error('远端新版本记录超过安全上限，请稍后重试')
}

export class CloudSyncCoordinator {
  private state: CloudSyncState
  private inFlight: Promise<CloudSyncExecution> | null = null

  constructor(private readonly dependencies: CloudSyncCoordinatorDependencies) {
    this.state = publicState(dependencies.readConfig())
  }

  private transition(input: Partial<CloudSyncState>): CloudSyncState {
    this.state = { ...this.state, ...input }
    this.dependencies.broadcast(this.state)
    return this.state
  }

  private safeMessage(error: unknown, token = ''): string {
    const message = error instanceof Error ? error.message : String(error)
    return token ? message.split(token).join('[credential]') : message
  }

  pause(message: string): CloudSyncState {
    const config = this.dependencies.readConfig()
    if (!config) return this.transition(publicState(null))
    if (config.enabled) this.dependencies.setEnabled(false)
    return this.transition(publicState({ ...config, enabled: false }, {
      phase: 'disabled',
      message,
    }))
  }

  private assertLocalLibrary(config: CloudSyncRuntimeConfig, localLibraryId: string): void {
    if (config.localLibraryId !== localLibraryId) {
      throw new Error('此云同步连接属于另一个本地资料库，已阻止自动同步；请在当前资料库中重新配置')
    }
  }

  async getState(): Promise<CloudSyncState> {
    const config = this.dependencies.readConfig()
    if (!config) return this.transition(publicState(null))
    try {
      return await this.dependencies.withLibrary(async (repository) => {
        const [status, assetStatus] = await Promise.all([
          repository.getLocalSyncStatus(),
          repository.getLocalAssetStatus(),
        ])
        this.assertLocalLibrary(config, status.libraryId)
        const retainedPhase = ['syncing', 'offline', 'error'].includes(this.state.phase)
          ? this.state.phase
          : config.enabled ? 'idle' : 'disabled'
        return this.transition({
          ...publicState(config),
          phase: retainedPhase,
          lastSyncAt: status.lastSyncAt,
          pendingCount: status.pendingCount,
          conflictCount: status.conflictCount,
          ...assetStatus,
          message: this.state.message,
        })
      })
    } catch (error) {
      return this.transition(publicState(config, {
        phase: config.enabled ? 'error' : 'disabled',
        message: this.safeMessage(error, config.token),
      }))
    }
  }

  async setup(mode: CloudSyncSetupMode): Promise<CloudSyncExecution> {
    const config = this.dependencies.readConfig()
    if (!config) throw new Error('请先保存云同步地址和令牌')
    this.transition({ ...publicState(config), phase: 'syncing', message: null })
    try {
      const execution = await this.dependencies.withLibrary(async (repository) => {
        let localStatus = await repository.getLocalSyncStatus()
        this.assertLocalLibrary(config, localStatus.libraryId)
        const transport = this.dependencies.createTransport(config)
        let appliedOperations: RemoteSyncOperation[] = []
        let authoritativeSnapshot: PersistedSnapshot | undefined
        if (mode === 'replace') {
          const remote = await transport.getLibraryState(config.libraryId)
          if (!remote) throw new Error('没有找到要重建的云端资料库')
          const nextEpoch = remote.epoch + 1
          await transport.resetLibrary(config.libraryId, remote.epoch, nextEpoch)
          await repository.resetMetadataSyncEpoch(nextEpoch)
          await repository.prepareMetadataSyncBootstrap()
          localStatus = await repository.getLocalSyncStatus()
        } else if (mode === 'create') {
          const exists = await transport.libraryExists(config.libraryId, localStatus.epoch)
          if (exists) throw new Error('该云端资料库已经存在，请改用“连接已有资料库”')
          const created = await transport.registerLibrary(config.libraryId, localStatus.epoch)
          if (!created) throw new Error('云端资料库刚被其他设备创建，请改用“连接已有资料库”')
          await repository.prepareMetadataSyncBootstrap()
        } else {
          const remote = await transport.getLibraryState(config.libraryId)
          if (!remote) {
            throw new Error('没有找到该云端资料库，请核对资料库 ID')
          }
          if (!remote.ready) throw new Error('云端资料库正在重建，请等待第一台设备完成后重试')
          if (remote.epoch < localStatus.epoch) throw new Error('云端资料库版本早于本机，已阻止降级连接')
          if (remote.epoch > localStatus.epoch) {
            const downloaded = await downloadRemoteEpoch(
              transport,
              config.libraryId,
              remote.epoch,
              localStatus.deviceId,
            )
            authoritativeSnapshot = await repository.adoptRemoteMetadataEpoch(
              remote.epoch,
              downloaded.operations,
              downloaded.pullCursor,
            )
            localStatus = await repository.getLocalSyncStatus()
          }
        }
        if (!authoritativeSnapshot) {
          const result = await runMetadataSyncCycle(
            remoteRepository(repository, config.libraryId),
            transport,
          )
          appliedOperations = result.appliedOperations
        }
        const assetResult = await runAssetSyncCycle(
          repository,
          transport,
          config.libraryId,
          localStatus.epoch,
        )
        if (mode === 'replace' || mode === 'create') {
          await transport.finalizeLibrary(config.libraryId, localStatus.epoch)
        }
        const [updated, assetStatus] = await Promise.all([
          repository.getLocalSyncStatus(),
          repository.getLocalAssetStatus(),
        ])
        return {
          state: publicState({ ...config, enabled: true }, {
            phase: 'idle',
            lastSyncAt: updated.lastSyncAt,
            pendingCount: updated.pendingCount,
            conflictCount: updated.conflictCount,
            ...assetStatus,
            message: assetResult.missingCount > 0
              ? `${assetResult.missingCount} 个历史图片附件在本机和云端均缺失`
              : null,
          }),
          appliedOperations,
          ...(authoritativeSnapshot ? { authoritativeSnapshot } : {}),
        }
      })
      this.dependencies.setEnabled(true)
      return { ...execution, state: this.transition(execution.state) }
    } catch (error) {
      const message = this.safeMessage(error, config.token)
      this.transition({ phase: 'error', message })
      throw new Error(message)
    }
  }

  runNow(): Promise<CloudSyncExecution> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runNowInternal().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runNowInternal(): Promise<CloudSyncExecution> {
    const config = this.dependencies.readConfig()
    if (!config?.enabled) {
      return { state: this.transition(publicState(config)), appliedOperations: [] }
    }
    this.transition({
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      libraryId: config.libraryId,
      hasToken: true,
      phase: 'syncing',
      message: null,
    })
    try {
      return await this.dependencies.withLibrary(async (repository) => {
        const before = await repository.getLocalSyncStatus()
        this.assertLocalLibrary(config, before.libraryId)
        this.transition({
          lastSyncAt: before.lastSyncAt,
          pendingCount: before.pendingCount,
          conflictCount: before.conflictCount,
        })
        const transport = this.dependencies.createTransport(config)
        const result = await runMetadataSyncCycle(
          remoteRepository(repository, config.libraryId),
          transport,
        )
        const assetResult = await runAssetSyncCycle(
          repository,
          transport,
          config.libraryId,
          before.epoch,
        )
        const [status, assetStatus] = await Promise.all([
          repository.getLocalSyncStatus(),
          repository.getLocalAssetStatus(),
        ])
        return {
          state: this.transition({
            ...publicState(config),
            phase: 'idle',
            lastSyncAt: status.lastSyncAt,
            pendingCount: status.pendingCount,
            conflictCount: status.conflictCount,
            ...assetStatus,
            message: assetResult.missingCount > 0
              ? `${assetResult.missingCount} 个历史图片附件在本机和云端均缺失`
              : null,
          }),
          appliedOperations: result.appliedOperations,
        }
      })
    } catch (error) {
      let message = this.safeMessage(error, config.token)
      const epochChanged = /epoch mismatch|资料库版本/i.test(message)
      if (epochChanged) {
        this.dependencies.setEnabled(false)
        message = '云端资料库已由另一台设备重建，自动同步已暂停；请点击“连接已有资料库”采用新版本'
      }
      const offline = /fetch|network|timeout|超时|ENOTFOUND|ECONN/i.test(message)
      return {
        state: this.transition({
          ...(epochChanged ? { enabled: false } : {}),
          phase: offline ? 'offline' : 'error',
          message,
        }),
        appliedOperations: [],
      }
    }
  }
}
