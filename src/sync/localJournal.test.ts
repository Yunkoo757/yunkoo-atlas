import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import type { PersistedSnapshot } from '@/storage/types'
import {
  collectSnapshotBootstrapMutations,
  collectSnapshotMutations,
  planLocalSyncBatch,
} from '@/sync/localJournal'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(): PersistedSnapshot {
  return {
    trades: [{
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
      note: '',
    }],
    strategies: [{ id: 'strategy-1', name: '趋势', icon: 'trending-up', color: '#5e6ad2' }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
}

export function testIdenticalSnapshotsProduceNoLocalMutations(): void {
  const current = snapshot()
  assert(
    collectSnapshotMutations(current, structuredClone(current)).length === 0,
    '相同快照不得制造待同步操作',
  )
}

export function testTradeEditProducesOnlyOneEntityMutation(): void {
  const previous = snapshot()
  const next = structuredClone(previous)
  next.trades[0]!.note = '<p>等待确认后入场</p>'

  const mutations = collectSnapshotMutations(previous, next)
  assert(mutations.length === 1, '单笔交易编辑只能产生一个实体变更')
  assert(mutations[0]?.entityType === 'trade', '变更实体应为交易')
  assert(mutations[0]?.entityId === 'trade-1', '变更实体 ID 必须稳定')
  assert(mutations[0]?.kind === 'upsert', '交易编辑应生成 upsert')
  assert(
    (mutations[0]?.payload as { note?: string } | null)?.note === '<p>等待确认后入场</p>',
    'outbox 必须携带最新实体内容',
  )
}

export function testHardDeleteProducesTombstoneMutation(): void {
  const previous = snapshot()
  const next = structuredClone(previous)
  next.trades = []

  const mutations = collectSnapshotMutations(previous, next)
  assert(mutations.length === 1, '硬删除只能产生一个墓碑变更')
  assert(mutations[0]?.entityType === 'trade', '墓碑实体应为交易')
  assert(mutations[0]?.entityId === 'trade-1', '墓碑必须保留原实体 ID')
  assert(mutations[0]?.kind === 'delete', '硬删除必须生成 delete')
  assert(mutations[0]?.payload === null, '墓碑不得携带旧实体内容')
}

export function testWorkspacePreferencesAreSplitIntoStableConflictGroups(): void {
  const previous = snapshot()
  const next = structuredClone(previous)
  next.tagPresets = ['伦敦开盘']
  next.display = { ...next.display, hideClosed: !next.display.hideClosed }

  const mutations = collectSnapshotMutations(previous, next)
  const ids = mutations.map((mutation) => `${mutation.entityType}:${mutation.entityId}`).sort()
  assert(
    JSON.stringify(ids) === JSON.stringify(['workspace:display', 'workspace:tags']),
    '显示偏好与标签库必须拆分，避免无关设置互相覆盖',
  )
}

export function testBootstrapCapturesTheCompleteCurrentLibraryOnce(): void {
  const mutations = collectSnapshotBootstrapMutations(snapshot())
  const ids = mutations.map((mutation) => `${mutation.entityType}:${mutation.entityId}`)

  assert(mutations.length === 9, '初始检查点必须包含交易、策略和七个工作区实体组')
  assert(ids.includes('trade:trade-1'), '初始检查点不得遗漏已有交易')
  assert(ids.includes('strategy:strategy-1'), '初始检查点不得遗漏已有策略')
  assert(ids.includes('workspace:tags'), '初始检查点必须携带空标签库，避免设备间残留旧值')
  assert(mutations.every((mutation) => mutation.kind === 'upsert'), '初始检查点只能描述当前实体')
}

export function testLocalSyncBatchKeepsOriginalBaseRevisionWhenCoalescing(): void {
  const batch = planLocalSyncBatch({
    mutations: [{
      entityType: 'trade', entityId: 'trade-1', kind: 'upsert', payload: { note: '最新' },
    }],
    deviceId: 'device-1',
    deviceSeq: 8,
    createdAt: '2026-07-15T00:00:00.000Z',
    createOperationId: () => 'op-latest',
    getCurrentRevision: () => 3,
    getPendingOperation: () => ({ baseRevision: 1 }),
  })

  assert(batch.deviceSeq === 9, '每个本地实体变更必须推进 deviceSeq')
  assert(batch.operations[0]?.baseRevision === 1, '合并操作必须保留最初基础版本')
  assert(batch.operations[0]?.revision === 4, '新操作必须从当前实体版本继续递增')
  assert(batch.versions[0]?.revision === 4, '实体版本与 outbox revision 必须一致')
}
