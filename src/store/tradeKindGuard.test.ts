import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { mergeImportPayload } from '@/lib/importMerge'
import { useStore } from '@/store/useStore'

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
    useStore.setState(previous)
  }
}

export function testStoreTradeKindTransitionCreatesOneActivityAndOneUndoAction(): void {
  withTrades([trade('planned')], () => {
    assert(useStore.getState().transitionTradeKind('planned', 'paper'), 'planned live→paper 应成功')
    const state = useStore.getState()
    const updated = state.trades[0]!
    assert(updated.tradeKind === 'paper', '合法转换必须更新类型')
    assert(state.undoStack.length === 1 && state.redoStack.length === 0, '合法转换必须只创建一个 Undo 动作')
    assert(updated.activities?.length === 1, '合法转换必须只追加一条活动')
    const activity = updated.activities?.[0]
    assert(
      activity?.kind === 'tradeKind' &&
        activity.fromTradeKind === 'live' &&
        activity.toTradeKind === 'paper',
      '类型活动必须记录 live→paper',
    )
    assert(useStore.getState().undo(state.undoStack[0]!.actionId), '类型转换必须可撤销')
    const restored = useStore.getState().trades[0]!
    assert(restored.tradeKind === 'live' && restored.activities === undefined, 'Undo 必须同时恢复类型与活动')
  })
}

export function testInvalidStoreTradeKindTransitionIsAReferencePreservingNoOp(): void {
  withTrades([trade('open', { status: 'open' })], () => {
    const before = useStore.getState()
    assert(!before.transitionTradeKind('open', 'paper'), 'open live→paper 必须拒绝')
    const after = useStore.getState()
    assert(
      after.trades === before.trades &&
        after.undoStack === before.undoStack &&
        after.redoStack === before.redoStack,
      '非法转换必须保持交易、Undo、Redo 引用不变',
    )
  })
}

export function testSameIdUpsertCannotChangeTradeKindOrOtherFields(): void {
  const original = trade('same-id', { note: '原值' })
  withTrades([original], () => {
    const before = useStore.getState()
    before.upsertTrade({ ...original, tradeKind: 'paper', note: '绕过修改' })
    const after = useStore.getState()
    assert(after.trades === before.trades && after.trades[0] === original, '同 ID 异类型 upsert 必须整笔零修改')
    assert(after.undoStack === before.undoStack, '被拒绝的 upsert 不得创建 Undo')
  })
}

export function testNewIdCaseCreationDoesNotMutateItsSourceTrade(): void {
  const original = trade('source')
  withTrades([original], () => {
    useStore.getState().upsertTrade({
      ...original,
      id: 'case-copy',
      ref: 'CASE-1',
      tradeKind: 'case',
      sourceTradeId: original.id,
    })
    const state = useStore.getState()
    assert(state.trades.find((item) => item.id === 'case-copy')?.tradeKind === 'case', '新 ID 可以创建案例')
    assert(state.trades.find((item) => item.id === original.id) === original, '创建案例不得修改来源交易')
  })
}

export function testSameIdImportCannotChangeTradeKindButNewIdKeepsItsKind(): void {
  const original = trade('same-id', { note: '本地原值' })
  const importedConflict = { ...original, tradeKind: 'paper' as const, note: '导入覆盖值' }
  const importedCase = trade('new-case', { tradeKind: 'case', sourceTradeId: original.id })
  const strategy = { id: 'strategy-1', name: '策略', icon: 'target' as const, color: '#000000' }
  const merged = mergeImportPayload({
    trades: [original],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }, {
    version: 8,
    trades: [importedConflict, importedCase],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  })
  const existing = merged.trades.find((item) => item.id === original.id)!
  assert(existing.tradeKind === 'live' && existing.note === '本地原值', '同 ID 异类型导入必须保留本地整笔记录')
  assert(merged.trades.find((item) => item.id === importedCase.id)?.tradeKind === 'case', '导入新 ID 必须保留既有类型')
}

export function testGeneralTradePatchExcludesTradeKindAtCompileTime(): void {
  if (Date.now() < 0) {
    // @ts-expect-error tradeKind 只能通过专用 transitionTradeKind 入口修改
    useStore.getState().updateTradeData('trade-id', { tradeKind: 'paper' })
  }
}

export function testGeneralTradePatchRejectsRuntimeTradeKindInjection(): void {
  const original = trade('runtime-guard', { status: 'open' })
  withTrades([original], () => {
    const before = useStore.getState()
    const unsafeUpdate = before.updateTradeData as unknown as (
      id: string,
      patch: Record<string, unknown>,
    ) => void
    unsafeUpdate(original.id, { tradeKind: 'paper' })
    const after = useStore.getState()
    assert(
      after.trades === before.trades &&
        after.undoStack === before.undoStack &&
        after.redoStack === before.redoStack,
      '运行时注入 tradeKind 的通用 patch 必须零字段、零活动、零 Undo 拒绝',
    )
  })
}
// Quality-Scenario: T-KIND-BYPASS
// Quality-Scenario: T-CASE-COPY
