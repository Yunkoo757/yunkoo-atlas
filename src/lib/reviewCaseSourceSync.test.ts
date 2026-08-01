import type { Trade } from '@/data/trades'
import { cascadeReviewCaseSourceSnapshot } from '@/lib/reviewCaseSourceSync'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    openedAt: '2026-08-01',
    closedAt: '2026-08-01',
    note: '',
    ...overrides,
  }
}

export function testCascadeReviewCaseSourceSnapshotUpdatesOnlyMatchingCases(): void {
  const source = trade('source', { note: '<p>最新来源</p>' })
  const activities = [{ id: 'activity-1', kind: 'note' as const, timestamp: '2026-07-31' }]
  const matchingCase = trade('matching-case', {
    ref: 'CAS-1',
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: '<p>旧来源</p>',
    note: '<p>案例结论</p>',
    deletedAt: '2026-08-01T00:00:00.000Z',
    activities,
  })
  const unrelatedCase = trade('unrelated-case', {
    ref: 'CAS-2',
    tradeKind: 'case',
    sourceTradeId: 'other-source',
    sourceNoteHtml: '<p>其他来源</p>',
    note: '<p>其他案例</p>',
  })

  const result = cascadeReviewCaseSourceSnapshot([source, matchingCase, unrelatedCase], source.id)
  const updated = result.find((item) => item.id === matchingCase.id)
  assert(updated?.sourceNoteHtml === source.note, '关联案例必须取得来源最新正文')
  assert(updated?.note === matchingCase.note, '级联不得覆盖案例正文')
  assert(updated?.activities === activities, '级联不得创建或替换案例活动')
  assert(updated?.deletedAt === matchingCase.deletedAt, '软删除案例必须同步且保持删除状态')
  assert(result.find((item) => item.id === unrelatedCase.id) === unrelatedCase, '无关案例必须保持对象引用')
}

export function testCascadeReviewCaseSourceSnapshotIsStableForMissingOrCaseSource(): void {
  const reviewCase = trade('case', {
    ref: 'CAS-1',
    tradeKind: 'case',
    sourceTradeId: 'source',
    sourceNoteHtml: '<p>来源</p>',
  })
  const trades = [reviewCase]
  assert(cascadeReviewCaseSourceSnapshot(trades, 'missing') === trades, '来源缺失时必须保持数组引用')
  assert(cascadeReviewCaseSourceSnapshot(trades, reviewCase.id) === trades, '案例自身不得触发反向级联')
}
