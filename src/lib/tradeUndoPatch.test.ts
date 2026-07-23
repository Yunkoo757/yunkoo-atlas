import type { Trade } from '@/data/trades'
import { applyUndoAction, buildUndoAction } from '@/lib/tradeUndo'

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

function action(before: Trade[], after: Trade[]) {
  const result = buildUndoAction({
    actionId: 'action-1',
    label: '更新交易',
    createdAt: '2026-07-22T00:00:00.000Z',
    before,
    after,
  })
  if (!result) throw new Error('测试动作不应为空')
  return result
}

export function testUndoActionUsesTheFinalBeforeAfterDiff(): void {
  const before = trade('1', { tags: ['before'], status: 'planned' })
  const after = trade('1', { tags: ['after'], status: 'open' })
  const result = action([before], [after])
  const keys = result.trades[0]!.fields.map((field) => field.key).sort()
  assert(keys.join(',') === 'status,tags', '动作必须从最终状态计算真实字段 diff')

  after.tags.push('mutated-later')
  const savedAfter = result.trades[0]!.fields.find((field) => field.key === 'tags')!.after as string[]
  assert(savedAfter.join(',') === 'after', 'Undo action 必须持有不可受调用方后续修改影响的字段副本')
}

export function testUndoPreservesFieldsChangedAfterTheAction(): void {
  const before = trade('1', { status: 'planned', note: 'before note' })
  const after = trade('1', { status: 'open', note: 'before note' })
  const current = { ...after, note: 'edited after action' }
  const result = applyUndoAction([current], action([before], [after]), 'undo')
  assert(result.ok, '非 touched 字段变化不得阻止 undo')
  if (!result.ok) return
  assert(result.trades[0]!.status === 'planned', 'undo 必须恢复 touched 字段')
  assert(result.trades[0]!.note === 'edited after action', 'undo 必须保留动作后的非 touched 字段')
}

export function testOneConflictRejectsTheWholeMultiTradeUndo(): void {
  const beforeA = trade('a', { status: 'planned' })
  const beforeB = trade('b', { status: 'planned' })
  const afterA = trade('a', { status: 'open' })
  const afterB = trade('b', { status: 'open' })
  const current = [afterA, { ...afterB, status: 'win' as const }]
  const result = applyUndoAction(current, action([beforeA, beforeB], [afterA, afterB]), 'undo')
  assert(!result.ok && result.reason === 'field-conflict', '任一 touched 字段偏离必须报告整组冲突')
  assert(result.trades === current, '冲突必须返回原数组并保证零部分修改')
  assert(current[0]!.status === 'open', '冲突时第一条记录不得被提前撤销')
}

export function testRedoIsSymmetricAndRejectsConflicts(): void {
  const before = trade('1', { status: 'planned', tags: ['old'] })
  const after = trade('1', { status: 'open', tags: ['new'] })
  const undoAction = action([before], [after])
  const undone = applyUndoAction([after], undoAction, 'undo')
  assert(undone.ok, '无冲突 undo 应成功')
  if (!undone.ok) return
  const redone = applyUndoAction(undone.trades, undoAction, 'redo')
  assert(redone.ok, '未改动 touched 字段时 redo 应成功')
  if (!redone.ok) return
  assert(redone.trades[0]!.status === 'open', 'redo 必须重放 after 字段')
  assert(redone.trades[0]!.tags.join(',') === 'new', 'redo 必须深度恢复数组字段')

  const conflicted = [{ ...undone.trades[0]!, tags: ['third value'] }]
  const rejected = applyUndoAction(conflicted, undoAction, 'redo')
  assert(!rejected.ok && rejected.trades === conflicted, 'redo touched 字段冲突必须整组拒绝且零修改')
}

export function testMissingTradeRejectsTheWholeAction(): void {
  const beforeA = trade('a', { status: 'planned' })
  const beforeB = trade('b', { status: 'planned' })
  const afterA = trade('a', { status: 'open' })
  const afterB = trade('b', { status: 'open' })
  const current = [afterA]
  const result = applyUndoAction(current, action([beforeA, beforeB], [afterA, afterB]), 'undo')
  assert(!result.ok && result.reason === 'missing-trade' && result.tradeId === 'b', '缺少任一交易必须整组拒绝')
  assert(result.trades === current, '缺少交易时不得分配部分结果')
}

export function testNoOpDoesNotCreateUndoHistory(): void {
  const current = trade('1')
  const result = buildUndoAction({
    actionId: 'noop',
    label: '无变化',
    createdAt: '2026-07-22T00:00:00.000Z',
    before: [current],
    after: [{ ...current }],
  })
  assert(result === null, '最终 before/after 无真实差异时不得创建历史动作')
}
