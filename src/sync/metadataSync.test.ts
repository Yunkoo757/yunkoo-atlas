import type { LocalSyncStatus, SyncOutboxOperation } from '@/sync/types'
import {
  runMetadataSyncCycle,
  type MetadataSyncRepository,
  type MetadataSyncTransport,
  type RemoteSyncOperation,
} from '@/sync/metadataSync'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function operation(overrides: Partial<SyncOutboxOperation> = {}): SyncOutboxOperation {
  return {
    opId: 'local-op-1',
    deviceId: 'device-a',
    deviceSeq: 1,
    entityType: 'trade',
    entityId: 'trade-1',
    kind: 'upsert',
    baseRevision: 0,
    revision: 1,
    payload: { id: 'trade-1', note: 'local' },
    createdAt: '2026-07-15T00:00:00.000Z',
    state: 'pending',
    ...overrides,
  }
}

class MemorySyncRepository implements MetadataSyncRepository {
  status: LocalSyncStatus = {
    libraryId: 'library-1',
    deviceId: 'device-a',
    epoch: 1,
    deviceSeq: 1,
    pullCursor: '10',
    lastSyncAt: null,
    pendingCount: 1,
    conflictCount: 0,
  }
  pending = [operation()]
  acknowledgements: Array<{ ids: string[]; cursor?: string }> = []
  applied: Array<{ operations: RemoteSyncOperation[]; cursor: string }> = []

  async getLocalSyncStatus() { return this.status }
  async listPendingSyncOperations(limit = 500) { return this.pending.slice(0, limit) }
  async acknowledgeSyncOperations(ids: string[], cursor?: string) {
    this.acknowledgements.push({ ids, cursor })
    this.pending = this.pending.filter((item) => !ids.includes(item.opId))
  }
  async applyRemoteSyncOperations(operations: RemoteSyncOperation[], cursor: string) {
    this.applied.push({ operations, cursor })
    return { appliedCount: operations.length, conflictCount: 0 }
  }
}

export async function testMetadataSyncPushesThenPullsWithoutSkippingRemoteHistory(): Promise<void> {
  const repository = new MemorySyncRepository()
  const calls: string[] = []
  const remote = operation({
    opId: 'remote-op-11',
    deviceId: 'device-b',
    entityId: 'trade-2',
    payload: { id: 'trade-2', note: 'remote' },
  }) as RemoteSyncOperation
  remote.cursor = '11'

  const transport: MetadataSyncTransport = {
    async push(request) {
      calls.push(`push:${request.operations.length}`)
      return { acknowledgedOperationIds: ['local-op-1'] }
    },
    async pull(request) {
      calls.push(`pull:${request.afterCursor}`)
      return { operations: [remote], nextCursor: '11', hasMore: false }
    },
  }

  const result = await runMetadataSyncCycle(repository, transport)

  assert(calls.join(',') === 'push:1,pull:10', '同步必须先上传 outbox，再从原 pullCursor 拉取')
  assert(repository.acknowledgements.length === 1, '成功 push 必须确认本地操作')
  assert(
    repository.acknowledgements[0]?.cursor === undefined,
    'push 的服务端 cursor 不得越过尚未 pull 的其他设备历史',
  )
  assert(repository.applied[0]?.cursor === '11', '远端操作与 pull cursor 必须一起应用')
  assert(result.pushedCount === 1, '结果应报告成功上传数量')
  assert(result.pulledCount === 1 && result.appliedCount === 1, '结果应报告拉取和应用数量')
}

export async function testPushFailureLeavesOutboxUntouchedAndSkipsPull(): Promise<void> {
  const repository = new MemorySyncRepository()
  let pullCalled = false
  const transport: MetadataSyncTransport = {
    async push() { throw new Error('offline') },
    async pull() {
      pullCalled = true
      return { operations: [], nextCursor: '10', hasMore: false }
    },
  }

  let rejected = false
  try {
    await runMetadataSyncCycle(repository, transport)
  } catch {
    rejected = true
  }
  assert(rejected, '网络上传失败必须结束本轮并保留可重试状态')
  assert(repository.acknowledgements.length === 0, '失败上传不得确认任何 outbox 操作')
  assert(!pullCalled, 'push 失败后不得继续制造部分同步状态')
}

export async function testMetadataSyncPullsEveryPageAndRejectsForeignAcknowledgements(): Promise<void> {
  const repository = new MemorySyncRepository()
  const cursors: Array<string | null> = []
  let page = 0
  const transport: MetadataSyncTransport = {
    async push() {
      return { acknowledgedOperationIds: ['foreign-op', 'local-op-1'] }
    },
    async pull(request) {
      cursors.push(request.afterCursor)
      page += 1
      const cursor = String(10 + page)
      return {
        operations: [operation({
          opId: `remote-${cursor}`, deviceId: 'device-b', entityId: `trade-${cursor}`,
        }) as RemoteSyncOperation].map((item) => ({ ...item, cursor })),
        nextCursor: cursor,
        hasMore: page === 1,
      }
    },
  }

  const result = await runMetadataSyncCycle(repository, transport)

  assert(repository.acknowledgements[0]?.ids.join(',') === 'local-op-1', '只能确认本批实际上传的操作 ID')
  assert(cursors.join(',') === '10,11', '分页拉取必须连续使用上一页返回的 cursor')
  assert(repository.applied.length === 2, '每一页远端操作都必须原子应用')
  assert(result.pulledCount === 2 && result.pullCursor === '12', '同步结果必须反映完整分页进度')
}

export async function testMetadataSyncDrainsLargeFirstDeviceBootstrapInOneCycle(): Promise<void> {
  const repository = new MemorySyncRepository()
  repository.pending = Array.from({ length: 450 }, (_, index) => operation({
    opId: `bootstrap-${index + 1}`,
    deviceSeq: index + 1,
    entityId: `trade-${index + 1}`,
    payload: { id: `trade-${index + 1}`, note: '完整检查点' },
  }))
  const batchSizes: number[] = []
  const transport: MetadataSyncTransport = {
    async push(request) {
      batchSizes.push(request.operations.length)
      return { acknowledgedOperationIds: request.operations.map((item) => item.opId) }
    },
    async pull(request) {
      return { operations: [], nextCursor: request.afterCursor ?? '0', hasMore: false }
    },
  }

  const result = await runMetadataSyncCycle(repository, transport)

  assert(batchSizes.join(',') === '200,200,50', '首次检查点必须在同一轮按安全批次全部上传')
  assert(result.pushedCount === 450, '同步结果必须报告全部已确认实体')
  assert(repository.pending.length === 0, '界面显示同步完成前不得残留检查点操作')
}

export async function testMetadataSyncSplitsLongNotesBelowTheServerBodyLimit(): Promise<void> {
  const repository = new MemorySyncRepository()
  repository.pending = [1, 2].map((index) => operation({
    opId: `large-${index}`,
    deviceSeq: index,
    entityId: `trade-large-${index}`,
    payload: { id: `trade-large-${index}`, note: '原'.repeat(310_000) },
  }))
  const batchSizes: number[] = []
  const transport: MetadataSyncTransport = {
    async push(request) {
      batchSizes.push(request.operations.length)
      return { acknowledgedOperationIds: request.operations.map((item) => item.opId) }
    },
    async pull(request) {
      return { operations: [], nextCursor: request.afterCursor ?? '0', hasMore: false }
    },
  }

  await runMetadataSyncCycle(repository, transport)

  assert(batchSizes.join(',') === '1,1', '长笔记必须拆批，不能超过服务端 JSON 上限')
}
