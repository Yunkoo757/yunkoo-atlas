import type { PersistedSnapshot } from '@/storage/types'
import type {
  LocalSyncBatch,
  SnapshotMutation,
  SyncEntityType,
  SyncOutboxOperation,
} from '@/sync/types'

interface SnapshotEntity {
  entityType: SyncEntityType
  entityId: string
  payload: unknown
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
  return `{${entries.join(',')}}`
}

function snapshotEntities(snapshot: PersistedSnapshot): SnapshotEntity[] {
  const entities: SnapshotEntity[] = [
    ...snapshot.trades.map((trade) => ({
      entityType: 'trade' as const,
      entityId: trade.id,
      payload: trade,
    })),
    ...snapshot.strategies.map((strategy) => ({
      entityType: 'strategy' as const,
      entityId: strategy.id,
      payload: strategy,
    })),
    {
      entityType: 'workspace',
      entityId: 'collections',
      payload: {
        starredIds: snapshot.starredIds,
        subscribedIds: snapshot.subscribedIds,
        pinnedStrategyIds: snapshot.pinnedStrategyIds,
      },
    },
    { entityType: 'workspace', entityId: 'display', payload: snapshot.display },
    {
      entityType: 'workspace',
      entityId: 'shortcuts',
      payload: snapshot.shortcuts ?? {},
    },
    {
      entityType: 'workspace',
      entityId: 'tags',
      payload: {
        tagPresets: snapshot.tagPresets ?? [],
        mistakeTagPresets: snapshot.mistakeTagPresets ?? [],
      },
    },
    {
      entityType: 'workspace',
      entityId: 'profile',
      payload: snapshot.profile ?? null,
    },
    {
      entityType: 'workspace',
      entityId: 'saved-trade-views',
      payload: snapshot.savedTradeViews ?? [],
    },
    {
      entityType: 'workspace',
      entityId: 'symbols',
      payload: {
        symbolIcons: snapshot.symbolIcons ?? {},
        symbolCatalog: snapshot.symbolCatalog ?? [],
      },
    },
  ]

  return entities
}

function entityKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}\u0000${entityId}`
}

/**
 * 将整份本地快照切成可独立同步、可独立解决冲突的稳定实体组。
 * 此函数只描述业务变更；revision、deviceSeq 与持久化由存储适配器负责。
 */
export function collectSnapshotMutations(
  previous: PersistedSnapshot,
  next: PersistedSnapshot,
): SnapshotMutation[] {
  const previousByKey = new Map(
    snapshotEntities(previous).map((entity) => [entityKey(entity.entityType, entity.entityId), entity]),
  )
  const nextByKey = new Map(
    snapshotEntities(next).map((entity) => [entityKey(entity.entityType, entity.entityId), entity]),
  )
  const keys = [...new Set([...previousByKey.keys(), ...nextByKey.keys()])].sort()
  const mutations: SnapshotMutation[] = []

  for (const key of keys) {
    const before = previousByKey.get(key)
    const after = nextByKey.get(key)
    if (!after && before) {
      mutations.push({
        entityType: before.entityType,
        entityId: before.entityId,
        kind: 'delete',
        payload: null,
      })
      continue
    }
    if (!after) continue
    if (before && stableSerialize(before.payload) === stableSerialize(after.payload)) continue
    mutations.push({
      entityType: after.entityType,
      entityId: after.entityId,
      kind: 'upsert',
      payload: after.payload,
    })
  }

  return mutations
}

/**
 * 为首次创建云端资料库生成完整检查点。即使某个工作区分组为空也必须上传，
 * 这样新设备不会把自己的旧默认值误当成云端真相。
 */
export function collectSnapshotBootstrapMutations(
  snapshot: PersistedSnapshot,
): SnapshotMutation[] {
  return snapshotEntities(snapshot)
    .sort((left, right) => (
      entityKey(left.entityType, left.entityId).localeCompare(entityKey(right.entityType, right.entityId))
    ))
    .map((entity) => ({
      entityType: entity.entityType,
      entityId: entity.entityId,
      kind: 'upsert',
      payload: entity.payload,
    }))
}

interface LocalSyncBatchInput {
  mutations: SnapshotMutation[]
  deviceId: string
  deviceSeq: number
  createdAt: string
  createOperationId(): string
  getCurrentRevision(entityType: SyncEntityType, entityId: string): number
  getPendingOperation(
    entityType: SyncEntityType,
    entityId: string,
  ): Pick<SyncOutboxOperation, 'baseRevision'> | undefined
}

/**
 * 为不同本地数据库生成完全一致的 revision、deviceSeq 与 outbox 合并结果。
 * 适配器只提供当前版本查询与持久化，不自行解释同步语义。
 */
export function planLocalSyncBatch(input: LocalSyncBatchInput): LocalSyncBatch {
  let deviceSeq = input.deviceSeq
  const operations: SyncOutboxOperation[] = []
  const versions: LocalSyncBatch['versions'] = []

  for (const mutation of input.mutations) {
    const currentRevision = input.getCurrentRevision(mutation.entityType, mutation.entityId)
    const revision = currentRevision + 1
    const baseRevision = input.getPendingOperation(mutation.entityType, mutation.entityId)
      ?.baseRevision ?? currentRevision
    deviceSeq += 1
    operations.push({
      ...mutation,
      opId: input.createOperationId(),
      deviceId: input.deviceId,
      deviceSeq,
      baseRevision,
      revision,
      createdAt: input.createdAt,
      state: 'pending',
    })
    versions.push({
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      revision,
      deleted: mutation.kind === 'delete',
      updatedAt: input.createdAt,
    })
  }

  return { deviceSeq, operations, versions }
}
