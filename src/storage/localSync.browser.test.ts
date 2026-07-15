import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'
import type { RemoteSyncOperation } from '@/sync/types'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('linear-journal-v3')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('测试数据库仍被占用'))
  })
}

function snapshot(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      hideClosed: false,
      showEmptyGroups: false,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      sidebarPins: [],
      sidebarWorkspaceItems: [],
    },
  }
}

export async function testIndexedDbSnapshotAndOutboxCommitTogether(): Promise<void> {
  await deleteTestDatabase()
  const adapter = new IndexedDbStorageAdapter()
  await adapter.open()

  const baseline = snapshot()
  await adapter.saveSnapshot(baseline)
  assert((await adapter.getLocalSyncStatus()).pendingCount === 0, '首份浏览器快照只应建立基线')

  const next = structuredClone(baseline)
  next.tagPresets = ['复盘重点']
  await adapter.saveSnapshot(next)

  const pending = await adapter.listPendingSyncOperations()
  assert(pending.length === 1, '浏览器保存必须同时生成一条 outbox 操作')
  assert(pending[0]?.entityType === 'workspace', '标签库应作为 workspace 实体同步')
  assert(pending[0]?.entityId === 'tags', '标签库必须使用稳定冲突组 ID')
  assert(pending[0]?.revision === 1, '首次修改 revision 应为 1')
  assert((await adapter.getLocalSyncStatus()).pendingCount === 1, '浏览器同步状态必须反映队列数量')

  await adapter.saveSnapshot({ ...baseline, tagPresets: ['第一版'] })
  await adapter.saveSnapshot({ ...baseline, tagPresets: ['第二版'] })

  const coalesced = await adapter.listPendingSyncOperations()
  assert(coalesced.length === 1, '浏览器连续编辑同一实体不得无限堆积队列')
  assert(coalesced[0]?.baseRevision === 0, '合并后必须保留首次基础版本')
  assert(coalesced[0]?.revision === 3, '合并后必须推进到最新 revision')
  assert(
    (coalesced[0]?.payload as { tagPresets?: string[] } | null)?.tagPresets?.[0] === '第二版',
    '合并后的操作必须保留最新标签内容',
  )

  await adapter.acknowledgeSyncOperations([pending[0]!.opId], 'cursor-stale')
  assert(
    (await adapter.getLocalSyncStatus()).pendingCount === 1,
    '浏览器旧操作确认不得删除已合并的新操作',
  )
  await adapter.acknowledgeSyncOperations([coalesced[0]!.opId], 'cursor-7')
  const acknowledged = await adapter.getLocalSyncStatus()
  assert(acknowledged.pendingCount === 0, '浏览器最新操作确认后队列应清空')
  assert(acknowledged.pullCursor === 'cursor-7', '浏览器必须原子持久化远端游标')

  const remoteOperation: RemoteSyncOperation = {
    opId: 'remote-browser-1', deviceId: 'device-b', deviceSeq: 1,
    entityType: 'workspace', entityId: 'tags', kind: 'upsert',
    baseRevision: 3, revision: 4,
    payload: { tagPresets: ['远端浏览器'], mistakeTagPresets: [] },
    createdAt: '2026-07-15T03:00:00.000Z', state: 'pending', cursor: '8',
  }
  const remoteApplied = await adapter.applyRemoteSyncOperations([remoteOperation], '8')
  assert(remoteApplied.appliedCount === 1, '浏览器必须应用独立远端修改')
  assert((await adapter.loadSnapshot())?.tagPresets?.[0] === '远端浏览器', '远端内容必须落入浏览器快照')
  assert((await adapter.getLocalSyncStatus()).pullCursor === '8', '浏览器快照和游标必须一起提交')

  await adapter.saveSnapshot({ ...(await adapter.loadSnapshot())!, tagPresets: ['浏览器本机未上传'] })
  const concurrent = { ...remoteOperation, opId: 'remote-browser-2', baseRevision: 4, revision: 5, cursor: '9' }
  const conflicted = await adapter.applyRemoteSyncOperations([concurrent], '9')
  assert(conflicted.conflictCount === 1, '浏览器并发远端修改必须转为冲突')
  assert((await adapter.loadSnapshot())?.tagPresets?.[0] === '浏览器本机未上传', '冲突不得覆盖浏览器本机内容')
  assert((await adapter.getLocalSyncStatus()).conflictCount === 1, '浏览器状态必须暴露冲突数量')
  assert((await adapter.listSyncConflicts())[0]?.remoteOperation.opId === 'remote-browser-2', '浏览器必须保留远端冲突内容')
}
