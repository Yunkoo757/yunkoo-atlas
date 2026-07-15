import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import {
  runMetadataSyncCycle,
  type MetadataSyncRepository,
  type MetadataSyncTransport,
} from '../../src/sync/metadataSync'
import type { RemoteSyncOperation, SyncOutboxOperation } from '../../src/sync/types'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function baseline(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: [],
    mistakeTagPresets: [],
  }
}

function repository(storage: LibraryStorage): MetadataSyncRepository {
  return {
    getLocalSyncStatus: async () => storage.getLocalSyncStatus(),
    listPendingSyncOperations: async (limit) => storage.listPendingSyncOperations(limit),
    acknowledgeSyncOperations: async (ids, cursor) => storage.acknowledgeSyncOperations(ids, cursor),
    applyRemoteSyncOperations: async (operations, cursor) => (
      storage.applyRemoteSyncOperations(operations, cursor)
    ),
  }
}

class InMemoryMetadataServer implements MetadataSyncTransport {
  private readonly operations: RemoteSyncOperation[] = []
  private readonly operationIds = new Set<string>()
  private readonly revisions = new Map<string, number>()

  async push(request: { operations: SyncOutboxOperation[] }): Promise<{
    acknowledgedOperationIds: string[]
  }> {
    const acknowledgedOperationIds: string[] = []
    for (const operation of request.operations) {
      if (this.operationIds.has(operation.opId)) {
        acknowledgedOperationIds.push(operation.opId)
        continue
      }
      const entityKey = `${operation.entityType}:${operation.entityId}`
      if ((this.revisions.get(entityKey) ?? 0) !== operation.baseRevision) continue
      const cursor = String(this.operations.length + 1)
      this.operations.push({ ...structuredClone(operation), cursor })
      this.operationIds.add(operation.opId)
      this.revisions.set(entityKey, operation.revision)
      acknowledgedOperationIds.push(operation.opId)
    }
    return { acknowledgedOperationIds }
  }

  async pull(request: { afterCursor: string | null; limit: number }): Promise<{
    operations: RemoteSyncOperation[]
    nextCursor: string
    hasMore: boolean
  }> {
    const after = Number(request.afterCursor ?? '0')
    const remaining = this.operations.filter((operation) => Number(operation.cursor) > after)
    const operations = remaining.slice(0, request.limit).map((operation) => structuredClone(operation))
    return {
      operations,
      nextCursor: operations.at(-1)?.cursor ?? request.afterCursor ?? '0',
      hasMore: remaining.length > operations.length,
    }
  }
}

export async function testTwoDevicesSyncAndPreserveConcurrentLocalChanges(): Promise<void> {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-device-a-'))
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-device-b-'))
  const storageA = new LibraryStorage(rootA)
  const storageB = new LibraryStorage(rootB)
  try {
    await storageA.open()
    await storageB.open()
    const manifestA = storageA.readManifest()
    storageB.writeManifest({ ...storageB.readManifest(), libraryId: manifestA.libraryId })
    const deviceABaseline = baseline()
    deviceABaseline.tagPresets = ['设备 A 初始标签']
    storageA.saveSnapshot(deviceABaseline)
    storageB.saveSnapshot(baseline())
    const transport = new InMemoryMetadataServer()

    assert(storageA.prepareMetadataSyncBootstrap() === 7, '首台设备必须先生成完整元数据检查点')
    await runMetadataSyncCycle(repository(storageA), transport)
    await runMetadataSyncCycle(repository(storageB), transport)

    assert(storageB.loadSnapshot()?.tagPresets?.[0] === '设备 A 初始标签', '设备 B 必须收到设备 A 的初始检查点')
    assert(storageB.getLocalSyncStatus().pendingCount === 0, '远端应用不得在设备 B 产生回声 outbox')

    storageA.saveSnapshot({ ...storageA.loadSnapshot()!, tagPresets: ['设备 A 新版'] })
    storageB.saveSnapshot({ ...storageB.loadSnapshot()!, tagPresets: ['设备 B 未上传'] })
    await runMetadataSyncCycle(repository(storageA), transport)
    const deviceBResult = await runMetadataSyncCycle(repository(storageB), transport)

    assert(deviceBResult.conflictCount === 1, '并发修改必须在设备 B 形成显式冲突')
    assert(storageB.loadSnapshot()?.tagPresets?.[0] === '设备 B 未上传', '远端并发版本不得覆盖本机修改')
    assert(storageB.getLocalSyncStatus().pendingCount === 1, '冲突时本机待上传修改必须保留')
    assert(storageB.getLocalSyncStatus().conflictCount === 1, '冲突必须进入可恢复的本地冲突队列')
  } finally {
    storageA.close()
    storageB.close()
    fs.rmSync(rootA, { recursive: true, force: true })
    fs.rmSync(rootB, { recursive: true, force: true })
  }
}
