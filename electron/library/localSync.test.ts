import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import type { RemoteSyncOperation } from '../../src/sync/types'
import { collectSnapshotBootstrapMutations } from '../../src/sync/localJournal'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
}

function remoteTags(payload: string[]): RemoteSyncOperation {
  return {
    opId: 'remote-tags-1', deviceId: 'device-b', deviceSeq: 1,
    entityType: 'workspace', entityId: 'tags', kind: 'upsert',
    baseRevision: 0, revision: 1,
    payload: { tagPresets: payload, mistakeTagPresets: [] },
    createdAt: '2026-07-15T02:00:00.000Z', state: 'pending', cursor: '1',
  }
}

export async function testLocalSyncJournalPersistsDeviceAndCoalescesRepeatedEdits(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-local-sync-'))
  let storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    storage.saveSnapshot(baseline)
    const initial = storage.getLocalSyncStatus()
    assert(initial.pendingCount === 0, '首次快照只建立本地基线，不应误报待同步')

    const first = structuredClone(baseline)
    first.trades.push({
      id: 'trade-1',
      ref: 'TRD-1',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'strategy-1',
      tradeKind: 'live',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      entry: null,
      exit: null,
      size: null,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-15',
      closedAt: null,
      note: '第一版',
    })
    storage.saveSnapshot(first)

    const second = structuredClone(first)
    second.trades[0]!.note = '第二版'
    storage.saveSnapshot(second)

    const pending = storage.listPendingSyncOperations()
    assert(pending.length === 1, '同一实体连续保存必须合并为一个待同步操作')
    assert(pending[0]?.entityType === 'trade', '待同步实体类型应为交易')
    assert(pending[0]?.entityId === 'trade-1', '待同步实体 ID 应保持稳定')
    assert(pending[0]?.baseRevision === 0, '合并操作必须保留首次变更的基础版本')
    assert(pending[0]?.revision === 2, '连续两次编辑必须推进本地 revision')
    assert((pending[0]?.payload as { note?: string } | null)?.note === '第二版', '队列只保留最新内容')
    assert(storage.getLocalSyncStatus().pendingCount === 1, '同步状态必须反映合并后的队列数量')

    const deviceId = storage.getLocalSyncStatus().deviceId
    storage.close()
    storage = new LibraryStorage(root)
    await storage.open()
    assert(storage.getLocalSyncStatus().deviceId === deviceId, 'deviceId 必须随资料库持久化')
    assert(storage.listPendingSyncOperations().length === 1, '重启后 outbox 不得丢失')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testLocalSyncJournalStoresHardDeleteAsTombstone(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-local-tombstone-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    baseline.trades.push({
      id: 'trade-delete', ref: 'TRD-2', symbol: 'EURUSD', side: 'short', status: 'open',
      conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live', tags: [], mistakeTags: [],
      reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: null, exit: null, size: null,
      pnl: null, rMultiple: null, openedAt: '2026-07-15', closedAt: null, note: '',
    })
    storage.saveSnapshot(baseline)
    storage.saveSnapshot({ ...baseline, trades: [] })

    const pending = storage.listPendingSyncOperations()
    assert(pending.length === 1, '硬删除应生成一个待同步墓碑')
    assert(pending[0]?.kind === 'delete', '硬删除操作类型必须为 delete')
    assert(pending[0]?.payload === null, '删除墓碑不得携带旧交易数据')
    assert(pending[0]?.revision === 1, '首次删除应从 revision 1 开始')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAtomicImportAlsoProducesLocalSyncOperations(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-sync-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    baseline.tagPresets = ['旧标签']
    storage.saveSnapshot(baseline)

    await storage.commitImport({ ...baseline, tagPresets: ['导入标签'] }, [])

    const pending = storage.listPendingSyncOperations()
    assert(pending.length === 1, '原子导入也必须产生增量同步操作')
    assert(pending[0]?.entityId === 'tags', '导入标签变化必须进入标签冲突组')
    assert(
      (pending[0]?.payload as { tagPresets?: string[] } | null)?.tagPresets?.[0] === '导入标签',
      '导入 outbox 必须携带最终提交内容',
    )
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testMetadataBootstrapIsAtomicAndIdempotent(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-bootstrap-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const current = snapshot()
    current.tagPresets = ['本机标签']
    storage.saveSnapshot(current)

    const prepared = storage.prepareMetadataSyncBootstrap()
    assert(prepared === 7, '空交易库的初始检查点应包含七个稳定工作区分组')
    assert(storage.isMetadataSyncBootstrapPrepared(), '检查点与标记必须在同一事务内完成')
    assert(storage.listPendingSyncOperations().length === 7, '检查点必须进入可靠 outbox')

    const repeated = storage.prepareMetadataSyncBootstrap()
    assert(repeated === 0, '重复准备不得再次推进 revision 或制造重复操作')
    assert(storage.listPendingSyncOperations().length === 7, '重复准备不得改变既有 outbox')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAcknowledgementCannotDeleteANewerCoalescedOperation(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-ack-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    storage.saveSnapshot(baseline)
    storage.saveSnapshot({ ...baseline, tagPresets: ['第一版'] })
    const staleOperationId = storage.listPendingSyncOperations()[0]?.opId
    assert(staleOperationId, '首次修改必须生成可确认的操作 ID')

    storage.saveSnapshot({ ...baseline, tagPresets: ['第二版'] })
    const latestOperationId = storage.listPendingSyncOperations()[0]?.opId
    assert(latestOperationId !== staleOperationId, '合并后的最新操作必须获得新 ID')

    storage.acknowledgeSyncOperations([staleOperationId!], 'cursor-stale')
    assert(storage.listPendingSyncOperations().length === 1, '旧请求的确认不得删除更新后的本地操作')

    storage.acknowledgeSyncOperations([latestOperationId!], 'cursor-42')
    const status = storage.getLocalSyncStatus()
    assert(status.pendingCount === 0, '最新操作确认后队列应清空')
    assert(status.pullCursor === 'cursor-42', '同步游标必须与确认原子保存')
    assert(status.lastSyncAt !== null, '成功确认必须记录最近同步时间')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testRemoteOperationsApplyWithoutEchoingBackIntoOutbox(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-remote-apply-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    storage.saveSnapshot(baseline)

    const applied = storage.applyRemoteSyncOperations([remoteTags(['远端标签'])], '1')

    assert(applied.appliedCount === 1 && applied.conflictCount === 0, '独立远端操作必须成功应用')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === '远端标签', '远端内容必须进入本地快照')
    assert(storage.listPendingSyncOperations().length === 0, '远端应用不得回声生成新的本地 outbox')
    assert(storage.getLocalSyncStatus().pullCursor === '1', '快照与 pull cursor 必须原子推进')

    storage.saveSnapshot({ ...storage.loadSnapshot()!, tagPresets: ['本机后续编辑'] })
    const pending = storage.listPendingSyncOperations()
    assert(pending[0]?.baseRevision === 1, '远端版本应用后，本机编辑必须从该 revision 继续')
    assert(pending[0]?.revision === 2, '本机后续编辑必须生成下一个 revision')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testConcurrentRemoteChangeIsPersistedAsConflict(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-remote-conflict-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const baseline = snapshot()
    storage.saveSnapshot(baseline)
    storage.saveSnapshot({ ...baseline, tagPresets: ['本机未上传'] })

    const applied = storage.applyRemoteSyncOperations([remoteTags(['另一台设备'])], '1')

    assert(applied.appliedCount === 0 && applied.conflictCount === 1, '并发远端修改必须转为冲突')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === '本机未上传', '冲突不得覆盖本机待上传内容')
    assert(storage.getLocalSyncStatus().conflictCount === 1, '同步状态必须暴露未解决冲突数量')
    assert(storage.getLocalSyncStatus().pullCursor === '1', '冲突已安全保存后仍应推进 pull cursor')
    const conflicts = storage.listSyncConflicts()
    assert(conflicts[0]?.remoteOperation.opId === 'remote-tags-1', '冲突必须保留完整远端操作')
    assert(conflicts[0]?.localRevision === 1, '冲突必须保留发生时的本地 revision')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testReplacingCloudEpochClearsOldSyncHistoryButKeepsTheRestoredSnapshot(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-epoch-reset-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const restored = snapshot()
    restored.tagPresets = ['恢复点标签']
    storage.saveSnapshot(restored)
    storage.saveSnapshot({ ...restored, mistakeTagPresets: ['本机待上传'] })
    assert(storage.getLocalSyncStatus().pendingCount === 1, '测试前必须存在旧 epoch 待上传数据')

    storage.resetMetadataSyncEpoch(4)

    const status = storage.getLocalSyncStatus()
    assert(status.epoch === 4 && status.deviceSeq === 0, '恢复替换必须切换到服务端分配的新 epoch')
    assert(status.pendingCount === 0 && status.conflictCount === 0, '旧 epoch 队列和冲突不得进入新历史')
    assert(status.pullCursor === null && status.lastSyncAt === null, '新 epoch 必须从空游标开始')
    assert(storage.loadSnapshot()?.mistakeTagPresets?.[0] === '本机待上传', '重置同步历史不得改变恢复后的业务数据')
    assert(storage.prepareMetadataSyncBootstrap() === 7, '重置后必须能为恢复结果生成完整检查点')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAdoptingRemoteEpochAtomicallyReplacesStaleLocalEntities(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-epoch-adopt-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const stale = snapshot()
    stale.trades.push({
      id: 'stale-trade', ref: 'TRD-9', symbol: 'BTCUSDT', side: 'long', status: 'open',
      conviction: 'medium', strategyId: '', tradeKind: 'live', tags: [], mistakeTags: [],
      reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: null, exit: null, size: null,
      pnl: null, rMultiple: null, openedAt: '2026-07-15', closedAt: null, note: '',
    })
    storage.saveSnapshot(stale)
    const authoritative = snapshot()
    authoritative.tagPresets = ['权威新版本']
    const operations = collectSnapshotBootstrapMutations(authoritative).map((mutation, index) => ({
      ...mutation,
      opId: `remote-bootstrap-${index + 1}`,
      deviceId: 'device-authoritative',
      deviceSeq: index + 1,
      baseRevision: 0,
      revision: 1,
      createdAt: '2026-07-15T03:00:00.000Z',
      state: 'pending' as const,
      cursor: String(index + 1),
    }))

    const adopted = storage.adoptRemoteMetadataEpoch(2, operations, String(operations.length))

    assert(adopted.trades.length === 0, '新 epoch 中不存在的旧交易必须被权威快照移除')
    assert(adopted.tagPresets?.[0] === '权威新版本', '新 epoch 工作区设置必须完整采用')
    assert(storage.getLocalSyncStatus().epoch === 2, '采用快照与 epoch 必须原子提交')
    assert(storage.listPendingSyncOperations().length === 0, '权威快照不得回声生成本地 outbox')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
