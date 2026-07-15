import type { PersistedSnapshot } from '@/storage/types'
import type { RemoteSyncOperation } from '@/sync/types'
import {
  mergeAcceptedRemoteOperations,
  planRemoteSnapshotApply,
} from '@/sync/remoteApply'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(): PersistedSnapshot {
  return {
    trades: [], strategies: [], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: {
      hideClosed: false, showEmptyGroups: false, groupByStrategy: false, groupByDate: true,
      sortBy: 'date', sidebarPins: [], sidebarWorkspaceItems: [],
    },
  }
}

function remote(overrides: Partial<RemoteSyncOperation> = {}): RemoteSyncOperation {
  return {
    opId: 'remote-op-1', deviceId: 'device-b', deviceSeq: 1,
    entityType: 'workspace', entityId: 'tags', kind: 'upsert',
    baseRevision: 0, revision: 1,
    payload: { tagPresets: ['远端标签'], mistakeTagPresets: ['追单'] },
    createdAt: '2026-07-15T01:00:00.000Z', state: 'pending', cursor: '1',
    ...overrides,
  }
}

export function testRemoteApplyUpdatesIndependentEntitiesAndVersions(): void {
  const result = planRemoteSnapshotApply({
    snapshot: snapshot(),
    operations: [remote()],
    localDeviceId: 'device-a',
    getCurrentRevision: () => 0,
    hasPendingOperation: () => false,
  })

  assert(result.snapshot.tagPresets?.[0] === '远端标签', '远端标签必须进入本地快照')
  assert(result.snapshot.mistakeTagPresets?.[0] === '追单', '远端错误标签必须完整应用')
  assert(result.appliedCount === 1 && result.conflicts.length === 0, '独立远端变更应直接应用')
  assert(result.versions[0]?.revision === 1, '本地实体版本必须推进到远端 revision')
}

export function testRemoteTradeUpsertAndTombstoneApplyInOrder(): void {
  const added = remote({
    opId: 'remote-trade-add',
    entityType: 'trade',
    entityId: 'trade-7',
    payload: {
      id: 'trade-7', ref: 'TRD-7', symbol: 'BTCUSDT', side: 'long', status: 'open',
      conviction: 'medium', strategyId: 'uncategorized', tradeKind: 'live', tags: [],
      mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: null,
      exit: null, size: null, pnl: null, rMultiple: null, openedAt: '2026-07-15',
      closedAt: null, note: '来自另一台设备',
    },
  })
  const deleted = remote({
    opId: 'remote-trade-delete',
    deviceSeq: 2,
    entityType: 'trade',
    entityId: 'trade-7',
    kind: 'delete',
    baseRevision: 1,
    revision: 2,
    payload: null,
    cursor: '2',
  })

  const result = planRemoteSnapshotApply({
    snapshot: snapshot(),
    operations: [added, deleted],
    localDeviceId: 'device-a',
    getCurrentRevision: () => 0,
    hasPendingOperation: () => false,
  })

  assert(result.snapshot.trades.length === 0, '远端硬删除墓碑必须移除先前同步的交易')
  assert(result.appliedCount === 2, '同一实体的连续远端历史必须按顺序完整应用')
  assert(result.versions.at(-1)?.revision === 2, '最终本地版本必须匹配删除墓碑 revision')
  assert(result.versions.at(-1)?.deleted === true, '最终版本必须保留删除标记')
}

export function testRemoteWorkspaceGroupsApplyWithoutOverwritingEachOther(): void {
  const operations: RemoteSyncOperation[] = [
    remote({ entityId: 'collections', payload: {
      starredIds: ['trade-1'], subscribedIds: ['trade-2'], pinnedStrategyIds: ['strategy-1'],
    } }),
    remote({ opId: 'display', entityId: 'display', payload: {
      hideClosed: true, showEmptyGroups: false, groupByStrategy: true, groupByDate: false,
      sortBy: 'pnl', sidebarPins: [], sidebarWorkspaceItems: [],
    } }),
    remote({ opId: 'shortcuts', entityId: 'shortcuts', payload: {
      'global.search': { mod: true, key: 'k' },
    } }),
    remote({ opId: 'profile', entityId: 'profile', payload: {
      avatarId: 'monogram', displayName: 'Yunkoo',
    } }),
    remote({ opId: 'views', entityId: 'saved-trade-views', payload: [{
      id: 'view-1', name: '伦敦盘', pathname: '/list', search: { session: 'london' },
      pinned: true, order: 0, createdAt: '2026-07-15', updatedAt: '2026-07-15',
    }] }),
    remote({ opId: 'symbols', entityId: 'symbols', payload: {
      symbolIcons: { BTCUSDT: { presetId: 'btc', updatedAt: '2026-07-15' } },
      symbolCatalog: ['BTCUSDT'],
    } }),
  ]

  const result = planRemoteSnapshotApply({
    snapshot: snapshot(), operations, localDeviceId: 'device-a',
    getCurrentRevision: () => 0, hasPendingOperation: () => false,
  })

  assert(result.snapshot.starredIds[0] === 'trade-1', '收藏集合必须同步')
  assert(result.snapshot.display.sortBy === 'pnl', '显示偏好必须同步')
  assert(result.snapshot.shortcuts?.['global.search'] !== undefined, '快捷键必须同步')
  assert(result.snapshot.profile?.displayName === 'Yunkoo', '个人资料必须同步')
  assert(result.snapshot.savedTradeViews?.[0]?.id === 'view-1', '保存视图必须同步')
  assert(result.snapshot.symbolCatalog?.[0] === 'BTCUSDT', '品种目录必须同步')
  assert(result.appliedCount === operations.length, '各工作区冲突组必须独立完整应用')
}

export function testRemoteChangeBecomesConflictWhenLocalEntityIsPending(): void {
  const local = snapshot()
  local.tagPresets = ['本机未上传']
  const result = planRemoteSnapshotApply({
    snapshot: local,
    operations: [remote()],
    localDeviceId: 'device-a',
    getCurrentRevision: () => 1,
    hasPendingOperation: (entityType, entityId) => entityType === 'workspace' && entityId === 'tags',
  })

  assert(result.snapshot.tagPresets?.[0] === '本机未上传', '远端并发变更不得覆盖本机待上传内容')
  assert(result.appliedCount === 0, '冲突操作不得伪装为已应用')
  assert(result.conflicts.length === 1, '冲突必须被显式保留，供后续冲突中心处理')
  assert(result.conflicts[0]?.localRevision === 1, '冲突必须记录本地版本上下文')
}

export function testAcceptedRemoteOperationsPreserveEditsMadeWhileSyncWasRunning(): void {
  const baseline = snapshot()
  baseline.tagPresets = ['同步前标签']
  const current = structuredClone(baseline)
  current.display = { ...current.display, groupByStrategy: true }
  const tagOperation = remote()
  const displayOperation = remote({
    opId: 'remote-display',
    entityId: 'display',
    payload: { ...baseline.display, sortBy: 'pnl' },
  })

  const result = mergeAcceptedRemoteOperations(
    baseline,
    current,
    [tagOperation, displayOperation],
  )

  assert(result.snapshot.tagPresets?.[0] === '远端标签', '同步期间未编辑的实体必须更新')
  assert(result.snapshot.display.groupByStrategy === true, '同步期间新发生的本机编辑必须保留')
  assert(result.deferredOperations[0]?.opId === 'remote-display', '被本机新编辑挡住的远端操作必须显式返回')
}
