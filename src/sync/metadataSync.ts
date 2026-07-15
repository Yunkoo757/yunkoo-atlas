import type {
  LocalSyncStatus,
  RemoteSyncApplyResult,
  RemoteSyncOperation,
  SyncOutboxOperation,
} from '@/sync/types'

export type { RemoteSyncOperation } from '@/sync/types'

const DEFAULT_PUSH_LIMIT = 200
const MAX_PUSH_BODY_BYTES = 1_750 * 1024
const MAX_PUSH_PAGES_PER_CYCLE = 100
const DEFAULT_PULL_LIMIT = 500
const MAX_PULL_PAGES_PER_CYCLE = 100

export interface MetadataSyncPushRequest {
  libraryId: string
  epoch: number
  deviceId: string
  operations: SyncOutboxOperation[]
}

export interface MetadataSyncPullRequest {
  libraryId: string
  epoch: number
  deviceId: string
  afterCursor: string | null
  limit: number
}

export interface MetadataSyncTransport {
  push(request: MetadataSyncPushRequest): Promise<{
    acknowledgedOperationIds: string[]
  }>
  pull(request: MetadataSyncPullRequest): Promise<{
    operations: RemoteSyncOperation[]
    nextCursor: string
    hasMore: boolean
  }>
}

export interface MetadataSyncRepository {
  getLocalSyncStatus(): Promise<LocalSyncStatus>
  listPendingSyncOperations(limit?: number): Promise<SyncOutboxOperation[]>
  acknowledgeSyncOperations(operationIds: string[], pullCursor?: string): Promise<void>
  applyRemoteSyncOperations(
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): Promise<RemoteSyncApplyResult>
}

export interface MetadataSyncCycleResult {
  pushedCount: number
  pulledCount: number
  appliedCount: number
  conflictCount: number
  appliedOperations: RemoteSyncOperation[]
  pullCursor: string | null
}

function fitPushBatch(
  status: LocalSyncStatus,
  operations: SyncOutboxOperation[],
): SyncOutboxOperation[] {
  const encoder = new TextEncoder()
  const batch: SyncOutboxOperation[] = []
  let bodyBytes = encoder.encode(JSON.stringify({
    libraryId: status.libraryId,
    epoch: status.epoch,
    deviceId: status.deviceId,
    operations: [],
  })).byteLength
  for (const operation of operations) {
    const operationBytes = encoder.encode(JSON.stringify(operation)).byteLength
      + (batch.length > 0 ? 1 : 0)
    if (bodyBytes + operationBytes > MAX_PUSH_BODY_BYTES) {
      if (batch.length === 0) {
        throw new Error(`同步实体 ${operation.entityType}/${operation.entityId} 内容过大，无法安全上传`)
      }
      break
    }
    batch.push(operation)
    bodyBytes += operationBytes
  }
  return batch
}

/**
 * 执行一次有限、可重试的元数据同步：先上传本地 outbox，再完整拉取远端历史。
 * 网络失败直接返回错误；本地操作只有在服务端明确确认后才会移出 outbox。
 */
export async function runMetadataSyncCycle(
  repository: MetadataSyncRepository,
  transport: MetadataSyncTransport,
): Promise<MetadataSyncCycleResult> {
  const status = await repository.getLocalSyncStatus()
  let pushedCount = 0
  let pushPage = 0
  for (; pushPage < MAX_PUSH_PAGES_PER_CYCLE; pushPage += 1) {
    const pending = await repository.listPendingSyncOperations(DEFAULT_PUSH_LIMIT)
    if (pending.length === 0) break
    const batch = fitPushBatch(status, pending)
    const pushedIds = new Set(batch.map((operation) => operation.opId))
    const pushResult = await transport.push({
      libraryId: status.libraryId,
      epoch: status.epoch,
      deviceId: status.deviceId,
      operations: batch,
    })
    const acknowledged = [...new Set(pushResult.acknowledgedOperationIds)]
      .filter((operationId) => pushedIds.has(operationId))
    if (acknowledged.length > 0) {
      // push 返回的 cursor 不能推进 pullCursor，否则可能跳过更早的其他设备操作。
      await repository.acknowledgeSyncOperations(acknowledged)
      pushedCount += acknowledged.length
    }
    // 未被确认的本地操作需要先拉取远端版本形成显式冲突，不能在本轮空转。
    if (acknowledged.length === 0) break
  }
  if (pushPage === MAX_PUSH_PAGES_PER_CYCLE) {
    const remaining = await repository.listPendingSyncOperations(1)
    if (remaining.length > 0) throw new Error('本轮待上传变更超过安全上限，请再次同步')
  }

  let cursor = status.pullCursor
  let pulledCount = 0
  let appliedCount = 0
  let conflictCount = 0
  const appliedOperations: RemoteSyncOperation[] = []
  for (let page = 0; page < MAX_PULL_PAGES_PER_CYCLE; page += 1) {
    const pullResult = await transport.pull({
      libraryId: status.libraryId,
      epoch: status.epoch,
      deviceId: status.deviceId,
      afterCursor: cursor,
      limit: DEFAULT_PULL_LIMIT,
    })
    if (pullResult.hasMore && pullResult.nextCursor === cursor) {
      throw new Error('远端同步游标未推进，已停止本轮同步以避免死循环')
    }
    const applied = await repository.applyRemoteSyncOperations(
      pullResult.operations,
      pullResult.nextCursor,
    )
    pulledCount += pullResult.operations.length
    appliedCount += applied.appliedCount
    conflictCount += applied.conflictCount
    appliedOperations.push(...(applied.appliedOperations ?? []))
    cursor = pullResult.nextCursor
    if (!pullResult.hasMore) break
    if (page === MAX_PULL_PAGES_PER_CYCLE - 1) {
      throw new Error('远端同步分页超过安全上限，请稍后继续')
    }
  }

  return {
    pushedCount,
    pulledCount,
    appliedCount,
    conflictCount,
    appliedOperations,
    pullCursor: cursor,
  }
}
