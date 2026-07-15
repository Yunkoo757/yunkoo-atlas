import type { PersistedSnapshot } from '@/storage/types'
import type {
  RemoteSyncOperation,
  SnapshotMutation,
  SyncEntityType,
  SyncEntityVersionUpdate,
} from '@/sync/types'

export interface RemoteSyncConflictCandidate {
  remoteOperation: RemoteSyncOperation
  localRevision: number
}

interface RemoteSnapshotApplyInput {
  snapshot: PersistedSnapshot
  operations: RemoteSyncOperation[]
  localDeviceId: string
  getCurrentRevision(entityType: SyncEntityType, entityId: string): number
  hasPendingOperation(entityType: SyncEntityType, entityId: string): boolean
}

export interface RemoteSnapshotApplyPlan {
  snapshot: PersistedSnapshot
  versions: SyncEntityVersionUpdate[]
  conflicts: RemoteSyncConflictCandidate[]
  appliedOperations: RemoteSyncOperation[]
  appliedCount: number
  skippedCount: number
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`远端同步字段 ${field} 格式无效`)
  }
  return value
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`远端同步字段 ${field} 格式无效`)
  }
  return value as Record<string, unknown>
}

function applyWorkspaceOperation(
  snapshot: PersistedSnapshot,
  operation: SnapshotMutation,
): PersistedSnapshot {
  if (operation.kind === 'delete') {
    throw new Error(`远端工作区操作无效：${operation.entityId}`)
  }
  switch (operation.entityId) {
    case 'collections': {
      const payload = record(operation.payload, 'collections')
      return {
        ...snapshot,
        starredIds: stringArray(payload.starredIds, 'starredIds'),
        subscribedIds: stringArray(payload.subscribedIds, 'subscribedIds'),
        pinnedStrategyIds: stringArray(payload.pinnedStrategyIds, 'pinnedStrategyIds'),
      }
    }
    case 'display':
      return {
        ...snapshot,
        display: record(operation.payload, 'display') as unknown as PersistedSnapshot['display'],
      }
    case 'shortcuts':
      return {
        ...snapshot,
        shortcuts: record(operation.payload, 'shortcuts') as PersistedSnapshot['shortcuts'],
      }
    case 'tags': {
      const payload = record(operation.payload, 'tags')
      return {
        ...snapshot,
        tagPresets: stringArray(payload.tagPresets, 'tagPresets'),
        mistakeTagPresets: stringArray(payload.mistakeTagPresets, 'mistakeTagPresets'),
      }
    }
    case 'profile':
      return {
        ...snapshot,
        profile: operation.payload === null
          ? undefined
          : record(operation.payload, 'profile') as unknown as PersistedSnapshot['profile'],
      }
    case 'saved-trade-views':
      if (!Array.isArray(operation.payload)) {
        throw new Error('远端同步字段 savedTradeViews 格式无效')
      }
      return {
        ...snapshot,
        savedTradeViews: operation.payload as PersistedSnapshot['savedTradeViews'],
      }
    case 'symbols': {
      const payload = record(operation.payload, 'symbols')
      return {
        ...snapshot,
        symbolIcons: record(payload.symbolIcons, 'symbolIcons') as PersistedSnapshot['symbolIcons'],
        symbolCatalog: stringArray(payload.symbolCatalog, 'symbolCatalog'),
      }
    }
    default:
      throw new Error(`未知的远端工作区实体：${operation.entityId}`)
  }
}

export function applySnapshotMutation(
  snapshot: PersistedSnapshot,
  operation: SnapshotMutation,
): PersistedSnapshot {
  if (operation.entityType === 'workspace') return applyWorkspaceOperation(snapshot, operation)
  if (operation.entityType === 'trade') {
    if (operation.kind === 'delete') {
      return { ...snapshot, trades: snapshot.trades.filter((trade) => trade.id !== operation.entityId) }
    }
    if (!operation.payload || typeof operation.payload !== 'object') {
      throw new Error(`远端交易内容无效：${operation.entityId}`)
    }
    const trade = operation.payload as PersistedSnapshot['trades'][number]
    if (trade.id !== operation.entityId) throw new Error(`远端交易 ID 不匹配：${operation.entityId}`)
    const exists = snapshot.trades.some((item) => item.id === operation.entityId)
    return {
      ...snapshot,
      trades: exists
        ? snapshot.trades.map((item) => item.id === operation.entityId ? trade : item)
        : [...snapshot.trades, trade],
    }
  }
  if (operation.entityType === 'strategy') {
    if (operation.kind === 'delete') {
      return {
        ...snapshot,
        strategies: snapshot.strategies.filter((strategy) => strategy.id !== operation.entityId),
      }
    }
    if (!operation.payload || typeof operation.payload !== 'object') {
      throw new Error(`远端策略内容无效：${operation.entityId}`)
    }
    const strategy = operation.payload as PersistedSnapshot['strategies'][number]
    if (strategy.id !== operation.entityId) throw new Error(`远端策略 ID 不匹配：${operation.entityId}`)
    const exists = snapshot.strategies.some((item) => item.id === operation.entityId)
    return {
      ...snapshot,
      strategies: exists
        ? snapshot.strategies.map((item) => item.id === operation.entityId ? strategy : item)
        : [...snapshot.strategies, strategy],
    }
  }
  return snapshot
}

function entityValue(snapshot: PersistedSnapshot, operation: RemoteSyncOperation): unknown {
  if (operation.entityType === 'trade') {
    return snapshot.trades.find((trade) => trade.id === operation.entityId) ?? null
  }
  if (operation.entityType === 'strategy') {
    return snapshot.strategies.find((strategy) => strategy.id === operation.entityId) ?? null
  }
  switch (operation.entityId) {
    case 'collections':
      return {
        starredIds: snapshot.starredIds,
        subscribedIds: snapshot.subscribedIds,
        pinnedStrategyIds: snapshot.pinnedStrategyIds,
      }
    case 'display': return snapshot.display
    case 'shortcuts': return snapshot.shortcuts ?? null
    case 'tags':
      return {
        tagPresets: snapshot.tagPresets ?? [],
        mistakeTagPresets: snapshot.mistakeTagPresets ?? [],
      }
    case 'profile': return snapshot.profile ?? null
    case 'saved-trade-views': return snapshot.savedTradeViews ?? []
    case 'symbols':
      return {
        symbolIcons: snapshot.symbolIcons ?? {},
        symbolCatalog: snapshot.symbolCatalog ?? [],
      }
    default: return null
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 将主进程已确认应用的远端操作合并回当前渲染状态。
 * 若用户在网络等待期间刚好改了同一实体，则暂缓该远端投影，让本机新编辑随后形成新 revision。
 */
export function mergeAcceptedRemoteOperations(
  baseline: PersistedSnapshot,
  current: PersistedSnapshot,
  operations: RemoteSyncOperation[],
): { snapshot: PersistedSnapshot; deferredOperations: RemoteSyncOperation[] } {
  let snapshot = current
  const deferredOperations: RemoteSyncOperation[] = []
  for (const operation of operations) {
    if (!sameValue(entityValue(baseline, operation), entityValue(current, operation))) {
      deferredOperations.push(operation)
      continue
    }
    snapshot = applySnapshotMutation(snapshot, operation)
  }
  return { snapshot, deferredOperations }
}

/**
 * 纯函数规划远端操作的本地投影。调用方在同一数据库事务中保存快照、版本和冲突。
 */
export function planRemoteSnapshotApply(input: RemoteSnapshotApplyInput): RemoteSnapshotApplyPlan {
  let snapshot = input.snapshot
  let appliedCount = 0
  let skippedCount = 0
  const versions: SyncEntityVersionUpdate[] = []
  const conflicts: RemoteSyncConflictCandidate[] = []
  const appliedOperations: RemoteSyncOperation[] = []
  const plannedRevisions = new Map<string, number>()

  for (const operation of input.operations) {
    if (operation.deviceId === input.localDeviceId) {
      skippedCount += 1
      continue
    }
    const key = `${operation.entityType}\u0000${operation.entityId}`
    const currentRevision = plannedRevisions.get(key)
      ?? input.getCurrentRevision(operation.entityType, operation.entityId)
    if (input.hasPendingOperation(operation.entityType, operation.entityId)) {
      conflicts.push({ remoteOperation: operation, localRevision: currentRevision })
      continue
    }
    if (operation.revision <= currentRevision) {
      skippedCount += 1
      continue
    }
    if (operation.baseRevision > currentRevision) {
      throw new Error(`远端同步历史不连续：${operation.entityType}/${operation.entityId}`)
    }
    if (operation.baseRevision < currentRevision) {
      conflicts.push({ remoteOperation: operation, localRevision: currentRevision })
      continue
    }

    snapshot = applySnapshotMutation(snapshot, operation)
    appliedCount += 1
    appliedOperations.push(operation)
    plannedRevisions.set(key, operation.revision)
    versions.push({
      entityType: operation.entityType,
      entityId: operation.entityId,
      revision: operation.revision,
      deleted: operation.kind === 'delete',
      updatedAt: operation.createdAt,
    })
  }

  return { snapshot, versions, conflicts, appliedOperations, appliedCount, skippedCount }
}
