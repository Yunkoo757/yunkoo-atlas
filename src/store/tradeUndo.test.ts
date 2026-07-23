import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { applySnapshotToStore } from '@/lib/importExport'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-22',
    closedAt: null,
    note: '',
    ...overrides,
  }
}

function withTrades(initial: Trade[], test: () => void): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: initial, undoStack: [], redoStack: [] })
    test()
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
    })
  }
}

export function testStoreUndoPreservesLaterUnrelatedFields(): void {
  withTrades([trade('1', { size: 1, conviction: 'medium' })], () => {
    useStore.getState().updateTradeData('1', { size: 2 })
    useStore.getState().setConviction('1', 'urgent')
    assert(useStore.getState().undo(), '无冲突的字段动作应可撤销')
    const restored = useStore.getState().trades[0]!
    assert(restored.size === 1, 'undo 必须恢复 touched 字段')
    assert(restored.conviction === 'urgent', 'undo 必须保留动作后的非 touched 字段')
  })
}

export function testOldActionIdTargetsItsOwnActionInsteadOfStackTop(): void {
  withTrades([trade('1', { size: 1, openedAt: '2026-07-20' })], () => {
    useStore.getState().updateTradeData('1', { size: 2 })
    const firstActionId = useStore.getState().undoStack.at(-1)!.actionId
    useStore.getState().updateTradeData('1', { openedAt: '2026-07-21' })
    const secondActionId = useStore.getState().undoStack.at(-1)!.actionId

    assert(useStore.getState().undo(firstActionId), '旧 Toast actionId 应能定位自己的非冲突动作')
    const state = useStore.getState()
    assert(state.trades[0]!.size === 1, '旧 actionId 必须撤销自己的字段')
    assert(state.trades[0]!.openedAt === '2026-07-21', '旧 actionId 不得误撤新的栈顶动作')
    assert(state.undoStack.some((action) => action.actionId === secondActionId), '较新的独立动作必须保留在 undo 栈')
  })
}

export function testTouchedFieldConflictLeavesStoreAndHistoryUntouched(): void {
  withTrades([trade('1', { size: 1 })], () => {
    useStore.getState().updateTradeData('1', { size: 2 })
    const firstActionId = useStore.getState().undoStack.at(-1)!.actionId
    useStore.getState().updateTradeData('1', { size: 3 })
    const before = useStore.getState()

    assert(!before.undo(firstActionId), '旧动作 touched 字段已偏离 after 时必须拒绝')
    const after = useStore.getState()
    assert(after.trades === before.trades && after.undoStack === before.undoStack, '冲突必须保持 store 与历史引用不变')
    assert(after.trades[0]!.size === 3 && after.redoStack.length === 0, '冲突不得产生部分 undo 或 redo')
  })
}

export function testBatchUndoConflictIsAllOrNothing(): void {
  withTrades([trade('a'), trade('b')], () => {
    useStore.getState().removeTrades(['a', 'b'])
    const actionId = useStore.getState().undoStack.at(-1)!.actionId
    useStore.getState().restoreTrade('b')
    const before = useStore.getState().trades

    assert(!useStore.getState().undo(actionId), '批量动作任一记录冲突必须整组拒绝')
    const after = useStore.getState().trades
    assert(after === before, '批量冲突必须保持交易数组引用不变')
    assert(Boolean(after.find((item) => item.id === 'a')!.deletedAt), '批量冲突不得提前恢复第一条记录')
    assert(!after.find((item) => item.id === 'b')!.deletedAt, '冲突记录的当前值必须保留')
  })
}

export function testRedoUsesTheSameActionAndRejectsLaterConflict(): void {
  withTrades([trade('1', { size: 1 })], () => {
    useStore.getState().updateTradeData('1', { size: 2 })
    const actionId = useStore.getState().undoStack.at(-1)!.actionId
    assert(useStore.getState().undo(actionId), '初次 undo 应成功')
    assert(useStore.getState().redo(actionId), '未冲突 redo 应对称成功')
    assert(useStore.getState().trades[0]!.size === 2, 'redo 必须恢复 after 值')

    assert(useStore.getState().undo(actionId), '再次 undo 应成功')
    useStore.getState().updateTradeData('1', { size: 4 })
    const before = useStore.getState()
    assert(!before.redo(actionId), 'redo 前 touched 字段偏离 before 必须拒绝')
    const after = useStore.getState()
    assert(after.trades === before.trades && after.redoStack === before.redoStack, 'redo 冲突必须零修改')
  })
}

export function testUndoActionsHaveDistinctIds(): void {
  withTrades([trade('1', { size: 1 })], () => {
    useStore.getState().updateTradeData('1', { size: 2 })
    useStore.getState().updateTradeData('1', { openedAt: '2026-07-23' })
    const ids = useStore.getState().undoStack.map((action) => action.actionId)
    assert(new Set(ids).size === ids.length, '每次 Store 动作必须生成唯一 actionId')
  })
}

export function testReplacingTheActiveSnapshotClearsSessionUndoHistory(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: [trade('1')], undoStack: [], redoStack: [] })
    useStore.getState().updateTradeData('1', { size: 2 })
    assert(useStore.getState().undoStack.length === 1, '测试前置必须创建会话历史')
    applySnapshotToStore(createFullPersistedSnapshotFixture())
    const state = useStore.getState()
    assert(state.undoStack.length === 0 && state.redoStack.length === 0, '替换或切换活动库快照时必须清空会话 Undo')
  } finally {
    useStore.setState(previous)
  }
}
// Quality-Scenario: T-UNDO-UNRELATED
// Quality-Scenario: T-UNDO-CONFLICT
// Quality-Scenario: T-REDO-CONFLICT
