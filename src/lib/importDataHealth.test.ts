import type { Trade } from '@/data/trades'
import {
  buildCopiedCloseDateCandidates,
  commitCopiedCloseDateCleanup,
  commitCopiedCloseDateCleanupThroughBoundary,
} from '@/lib/importDataHealth'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot, PersistedTrade } from '@/storage/types'
import { applyUndoAction, buildUndoAction, undoValuesEqual } from '@/lib/tradeUndo'
import {
  recoverCopiedCloseDateCleanupToStore,
  useStore,
} from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, overrides: Partial<PersistedTrade> = {}): PersistedTrade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2025-11-03',
    closedAt: '2025-11-03',
    closedTradingDayKey: '2025-11-03',
    note: '',
    ...overrides,
  }
}

function snapshot(trades: PersistedTrade[]): PersistedSnapshot {
  return { ...createEmptyPersistedSnapshot(), trades }
}

export function testCandidatesRequireNotionAndSameLegalBusinessDay(): void {
  const high = trade('high', {
    importProvenance: {
      source: 'notion',
      importedAt: '2025-11-04T00:00:00.000Z',
      openedAtSource: 'notion-date',
      closedAtSource: 'missing-in-source',
    },
  })
  const weak = trade('weak', { tags: ['notion-import'] })
  const manualSameDay = trade('manual')
  const invalidDay = trade('invalid', {
    tags: ['notion-import'],
    openedAt: '2025-02-30',
    closedAt: '2025-02-30',
    closedTradingDayKey: undefined,
  })
  const nonTerminal = trade('open', { status: 'open', closedTradingDayKey: undefined })
  const differentDay = trade('different', {
    tags: ['notion-import'],
    closedAt: '2025-11-04',
    closedTradingDayKey: '2025-11-04',
  })

  const candidates = buildCopiedCloseDateCandidates(
    [high, weak, manualSameDay, invalidDay, nonTerminal, differentDay],
    6,
  )

  assert(candidates.length === 2, '只应列出具有 Notion 来源证据且同一合法业务日的终态记录')
  assert(candidates[0]?.tradeId === 'high' && candidates[0].confidence === 'high', '显式缺少来源平仓日证据应为高置信')
  assert(candidates[0]?.selectedByDefault === true, '只有高置信记录可默认选中')
  assert(candidates[1]?.tradeId === 'weak' && candidates[1].confidence === 'manual-review', '旧标签证据只能进入人工核对')
  assert(candidates[1]?.selectedByDefault === false, '证据不足记录必须默认不选中')
}

export function testRealSameDayCloseIsNeverAutomaticWithoutOpenedOnlyEvidence(): void {
  const candidate = buildCopiedCloseDateCandidates([
    trade('real-same-day', {
      importProvenance: {
        source: 'notion',
        importedAt: '2025-11-04T00:00:00.000Z',
        openedAtSource: 'notion-date',
        closedAtSource: 'notion-close-date',
      },
    }),
  ], 6)[0]

  assert(candidate?.confidence === 'manual-review', '真实 Notion 平仓日不得判为高置信污染')
  assert(candidate.selectedByDefault === false, '真实同日开平不得自动选中')
}

export async function testCleanupPersistsBeforePublishingAndUndoPatchRestoresExactFields(): Promise<void> {
  const original = trade('cleanup', {
    importProvenance: {
      source: 'notion',
      importedAt: '2025-11-04T00:00:00.000Z',
      openedAtSource: 'notion-date',
      closedAtSource: 'missing-in-source',
    },
  })
  const baseline = snapshot([original])
  const events: string[] = []
  let published: Trade[] | null = null
  const result = await commitCopiedCloseDateCleanup({
    tradeIds: ['cleanup'],
    tradingDayStartHour: 6,
    captureLatest: () => ({ trades: [original], snapshot: baseline }),
    persistSnapshot: async (candidate) => {
      events.push('persist')
      assert(candidate.trades[0]?.closedAt === null, '持久化候选必须先清空平仓日')
      assert(candidate.trades[0]?.closedTradingDayKey === undefined, '持久化候选必须同步清空冻结业务日')
    },
    publish: (trades) => {
      events.push('publish')
      published = trades
    },
  })

  assert(result.kind === 'committed', '有效候选必须完成提交')
  assert(events.join(',') === 'persist,publish', '必须先持久化成功再发布到 Store')
  const committedTrades: Trade[] = published ?? []
  assert(committedTrades[0]?.closedAt === null, '发布后 closedAt 必须为 null')
  assert(committedTrades[0]?.closedTradingDayKey === undefined, '发布后冻结平仓业务日必须移除')
  assert(result.before[0]?.closedAt === '2025-11-03', '撤销 patch 必须保留原始 closedAt')
  assert(result.before[0]?.closedTradingDayKey === '2025-11-03', '撤销 patch 必须保留原始冻结业务日')
  const action = buildUndoAction({
    actionId: 'cleanup-action',
    label: '清空污染平仓日',
    createdAt: '2026-08-09T00:00:00.000Z',
    before: result.before,
    after: result.after,
  })
  assert(action, '清理必须生成可撤销字段 patch')
  const undone = applyUndoAction(committedTrades, action, 'undo')
  assert(undone.ok, '清理 patch 必须可以无冲突撤销')
  assert(undoValuesEqual(undone.trades[0], original), '撤销必须逐字段、逐字节恢复原记录值')
}

export async function testPersistenceFailureKeepsOriginalTradeAndDoesNotPublish(): Promise<void> {
  const original = trade('failure', { tags: ['notion-import'] })
  let published = false
  let rejected = false
  try {
    await commitCopiedCloseDateCleanup({
      tradeIds: ['failure'],
      tradingDayStartHour: 6,
      captureLatest: () => ({ trades: [original], snapshot: snapshot([original]) }),
      persistSnapshot: async () => { throw new Error('disk full') },
      publish: () => { published = true },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'disk full'
  }

  assert(rejected, '持久化错误必须透传给调用方')
  assert(!published, '持久化失败不得发布任何内存修改')
  assert(original.closedAt === '2025-11-03' && original.closedTradingDayKey === '2025-11-03', '失败后原记录必须逐字段保持')
}

export async function testStaleSelectionIsRejectedBeforePersistence(): Promise<void> {
  const changed = trade('stale', { closedAt: '2025-11-04', closedTradingDayKey: '2025-11-04', tags: ['notion-import'] })
  let persisted = false
  const result = await commitCopiedCloseDateCleanup({
    tradeIds: ['stale'],
    tradingDayStartHour: 6,
    captureLatest: () => ({ trades: [changed], snapshot: snapshot([changed]) }),
    persistSnapshot: async () => { persisted = true },
    publish: () => { throw new Error('不得发布') },
  })

  assert(result.kind === 'stale-selection', '确认后事实已变化时必须要求重新核对')
  assert(!persisted, '失效选择不得进入持久化边界')
}

export async function testBoundaryDiscardsOldAutosaveIfPublishFailsAfterDurableCommit(): Promise<void> {
  const original = trade('publish-failure', { tags: ['notion-import'] })
  const events: string[] = []
  let durable = snapshot([original])
  let memory = snapshot([original])
  let rejected = false
  try {
    await commitCopiedCloseDateCleanupThroughBoundary({
      cleanup: {
        tradeIds: ['publish-failure'],
        tradingDayStartHour: 6,
        captureLatest: () => ({ trades: [original], snapshot: snapshot([original]) }),
        persistSnapshot: async (next) => { events.push('persist'); durable = next },
        publish: () => { events.push('publish'); throw new Error('publish failed') },
      },
      boundary: {
        lockInteraction: () => { events.push('lock'); return () => { events.push('unlock') } },
        flushBeforeCommit: async () => { events.push('flush') },
        createVerifiedBackup: async () => { events.push('backup') },
        suspendPersist: () => { events.push('suspend') },
        resumePersist: () => { events.push('resume') },
        discardPendingAndResumePersist: () => { events.push('discard-resume') },
        recoverDurableSnapshot: (snapshot) => {
          events.push('recover')
          memory = snapshot
          assert(snapshot.trades[0]?.closedAt === null, '发布失败恢复必须使用已耐久快照')
        },
      },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'publish failed'
  }

  assert(rejected, '发布异常必须透传并交由上层要求重载')
  assert(
    events.join(',') === 'lock,flush,backup,suspend,persist,publish,recover,discard-resume,unlock',
    '一旦持久化成功，即使发布失败也必须恢复耐久快照并丢弃旧 autosave',
  )
  assert(memory.trades[0]?.closedAt === null, '发布失败后最终内存必须恢复为清理后的耐久状态')
  assert(JSON.stringify(memory) === JSON.stringify(durable), '发布失败恢复后内存与磁盘必须完全一致')
}

export async function testVerifiedBackupFailurePreventsCommitAndPublish(): Promise<void> {
  const original = trade('backup-failure', { tags: ['notion-import'] })
  const events: string[] = []
  let persisted = false
  let published = false
  let rejected = false
  try {
    await commitCopiedCloseDateCleanupThroughBoundary({
      cleanup: {
        tradeIds: ['backup-failure'],
        tradingDayStartHour: 6,
        captureLatest: () => ({ trades: [original], snapshot: snapshot([original]) }),
        persistSnapshot: async () => { persisted = true },
        publish: () => { published = true },
      },
      boundary: {
        lockInteraction: () => { events.push('lock'); return () => { events.push('unlock') } },
        flushBeforeCommit: async () => { events.push('flush') },
        createVerifiedBackup: async () => { events.push('backup'); throw new Error('backup invalid') },
        suspendPersist: () => { events.push('suspend') },
        resumePersist: () => { events.push('resume') },
        discardPendingAndResumePersist: () => { events.push('discard-resume') },
        recoverDurableSnapshot: () => { events.push('recover') },
      },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'backup invalid'
  }
  assert(rejected, '可验证备份失败必须透传')
  assert(events.join(',') === 'lock,flush,backup,unlock', '备份失败必须在 suspend 与 durable commit 前停止')
  assert(!persisted && !published, '备份失败不得提交或发布')
  assert(original.closedAt === '2025-11-03', '备份失败必须保持原值')
}

function successfulStoreBoundary(events: string[]) {
  return {
    lockInteraction: () => { events.push('lock'); return () => { events.push('unlock') } },
    flushBeforeCommit: async () => { events.push('flush') },
    createVerifiedBackup: async () => { events.push('backup') },
    suspendPersist: () => { events.push('suspend') },
    resumePersist: () => { events.push('resume') },
    discardPendingAndResumePersist: () => { events.push('discard-resume') },
    recoverDurableSnapshot: () => { events.push('recover') },
  }
}

export async function testStoreCleanupAndUndoBothCommitBeforePublish(): Promise<void> {
  const previous = useStore.getState()
  const original = trade('store-durable', { tags: ['notion-import'] })
  const diskWrites: PersistedSnapshot[] = []
  const events: string[] = []
  try {
    useStore.setState({ trades: [original], undoStack: [], redoStack: [] })
    const dependencies = {
      boundary: successfulStoreBoundary(events),
      persistSnapshot: async (next: PersistedSnapshot) => {
        events.push('persist')
        diskWrites.push(next)
      },
    }
    const cleaned = await useStore.getState().cleanupCopiedCloseDates(['store-durable'], dependencies)
    assert(cleaned.kind === 'committed' && cleaned.actionId, '真实 Store 清理必须返回耐久 actionId')
    assert(useStore.getState().trades[0]?.closedAt === null, '真实 Store 仅在持久化后发布清理')
    assert(diskWrites.at(-1)?.trades[0]?.closedAt === null, '清理快照必须已写入 storage')

    const undone = await useStore.getState().undoCopiedCloseDateCleanup(cleaned.actionId, dependencies)
    assert(undone.kind === 'committed', '耐久撤销必须成功')
    assert(useStore.getState().trades[0]?.closedAt === '2025-11-03', '耐久撤销成功后 Store 才恢复原日期')
    assert(diskWrites.at(-1)?.trades[0]?.closedAt === '2025-11-03', '耐久撤销必须先恢复 storage 快照')
    assert(events.join(',').includes('backup,suspend,persist'), '清理与撤销都必须经过备份和 commit-before-publish')
  } finally {
    useStore.setState(previous)
  }
}

export async function testStoreUndoPersistenceFailureKeepsCleanedMemoryAndDisk(): Promise<void> {
  const previous = useStore.getState()
  const original = trade('undo-failure', { tags: ['notion-import'] })
  let durable = snapshot([original])
  try {
    useStore.setState({ trades: [original], undoStack: [], redoStack: [] })
    const cleanDependencies = {
      boundary: successfulStoreBoundary([]),
      persistSnapshot: async (next: PersistedSnapshot) => { durable = next },
    }
    const cleaned = await useStore.getState().cleanupCopiedCloseDates(['undo-failure'], cleanDependencies)
    assert(cleaned.kind === 'committed' && cleaned.actionId, 'fixture 清理必须成功')
    let rejected = false
    try {
      await useStore.getState().undoCopiedCloseDateCleanup(cleaned.actionId, {
        boundary: successfulStoreBoundary([]),
        persistSnapshot: async () => { throw new Error('undo disk full') },
      })
    } catch (error) {
      rejected = error instanceof Error && error.message === 'undo disk full'
    }
    assert(rejected, '撤销持久化失败必须透传')
    assert(useStore.getState().trades[0]?.closedAt === null, '撤销写盘失败不得提前恢复内存')
    assert(durable.trades[0]?.closedAt === null, '撤销写盘失败必须保持磁盘清理状态')
    assert(useStore.getState().undoStack.some((action) => action.actionId === cleaned.actionId), '失败后撤销 action 必须保留以便重试')
  } finally {
    useStore.setState(previous)
  }
}

export async function testPublishFailureRecoveryPreservesHistoryAndKeepsCleanupDurablyUndoable(): Promise<void> {
  const previous = useStore.getState()
  const original = trade('recover-cleanup', { tags: ['notion-import'] })
  const unrelatedBefore = trade('unrelated-history', { note: 'before' })
  const unrelatedAfter = { ...unrelatedBefore, note: 'after' }
  const oldUndo = buildUndoAction({
    actionId: 'old-undo',
    label: '无关旧撤销',
    createdAt: '2026-08-08T00:00:00.000Z',
    before: [unrelatedBefore],
    after: [unrelatedAfter],
  })!
  const oldRedo = buildUndoAction({
    actionId: 'old-redo',
    label: '无关旧重做',
    createdAt: '2026-08-08T00:00:01.000Z',
    before: [unrelatedBefore],
    after: [unrelatedAfter],
  })!
  let durable = snapshot([original, unrelatedAfter])
  let cleanupAction: ReturnType<typeof buildUndoAction> = null
  try {
    useStore.setState({
      trades: [original, unrelatedAfter],
      undoStack: [oldUndo],
      redoStack: [oldRedo],
    })
    let rejected = false
    try {
      await commitCopiedCloseDateCleanupThroughBoundary({
        cleanup: {
          tradeIds: ['recover-cleanup'],
          tradingDayStartHour: 6,
          captureLatest: () => ({
            trades: useStore.getState().trades,
            snapshot: snapshot(useStore.getState().trades),
          }),
          persistSnapshot: async (next) => {
            const cleaned = next.trades.find((item) => item.id === original.id)!
            cleanupAction = buildUndoAction({
              actionId: 'recovered-cleanup-action',
              label: '清空污染平仓日',
              createdAt: '2026-08-09T00:00:00.000Z',
              before: [original],
              after: [cleaned],
            })
            durable = next
          },
          publish: () => { throw new Error('injected publish failure') },
        },
        boundary: {
          ...successfulStoreBoundary([]),
          recoverDurableSnapshot: (next) => {
            assert(cleanupAction, 'durable commit 前必须已准备好稳定的清理 action')
            recoverCopiedCloseDateCleanupToStore(next, cleanupAction)
          },
        },
      })
    } catch (error) {
      rejected = error instanceof Error && error.message === 'injected publish failure'
    }
    assert(rejected, '注入 publish failure 必须透传')
    assert(durable.trades.find((item) => item.id === original.id)?.closedAt === null, '磁盘必须保持清理态')
    assert(useStore.getState().trades.find((item) => item.id === original.id)?.closedAt === null, '恢复后的内存必须同步耐久清理态')
    assert(useStore.getState().undoStack.some((action) => action.actionId === oldUndo.actionId), '恢复不得清空无关 undo 历史')
    assert(useStore.getState().redoStack.some((action) => action.actionId === oldRedo.actionId), '恢复不得清空无关 redo 历史')
    assert(useStore.getState().undoStack.some((action) => action.actionId === cleanupAction?.actionId), '恢复必须加入本次清理 action')

    const undone = await useStore.getState().undoCopiedCloseDateCleanup('recovered-cleanup-action', {
      boundary: successfulStoreBoundary([]),
      persistSnapshot: async (next) => { durable = next },
    })
    assert(undone.kind === 'committed', '发布失败恢复出的清理 action 必须仍可耐久撤销')
    assert(durable.trades.find((item) => item.id === original.id)?.closedAt === original.closedAt, '耐久撤销必须恢复磁盘原日期')
    assert(useStore.getState().trades.find((item) => item.id === original.id)?.closedAt === original.closedAt, '耐久撤销成功后内存必须与磁盘一致')
    assert(useStore.getState().undoStack.some((action) => action.actionId === oldUndo.actionId), '耐久撤销不得删除无关 undo 历史')
    assert(useStore.getState().redoStack.some((action) => action.actionId === oldRedo.actionId), '耐久撤销不得删除无关 redo 历史')
  } finally {
    useStore.setState(previous)
  }
}
