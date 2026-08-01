import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'

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
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-07-31',
    closedAt: '2026-07-31',
    note: '',
    ...overrides,
  }
}

function withTrades(initial: Trade[], run: () => void): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: initial, undoStack: [], redoStack: [] })
    run()
  } finally {
    useStore.setState(previous)
  }
}

export function testStoreCreatesCaseFromCurrentSourceState(): void {
  withTrades([trade('source', { note: '<p>store 最新正文</p>' })], () => {
    const result = useStore.getState().createReviewCaseFromTrade('source')
    assert(result.status === 'created', '来源存在时必须创建案例')
    if (result.status !== 'created') return
    assert(result.reviewCase.sourceNoteHtml === '<p>store 最新正文</p>', '必须读取动作执行瞬间的 state')
    assert(result.reviewCase.note === '', '案例沉淀正文必须为空')
  })
}

export function testSourceNoteCascadesWithoutTouchingCaseOwnedFields(): void {
  const source = trade('source')
  const reviewCase = trade('case', {
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: '<p>旧来源</p>',
    note: '<p>案例结论</p>',
    deletedAt: '2026-08-01T00:00:00.000Z',
    masteryState: 'recheck',
    activities: [{ id: 'a1', kind: 'note', timestamp: '2026-07-31' }],
  })
  withTrades([source, reviewCase], () => {
    useStore.getState().updateNote(source.id, '<p>新来源</p>')
    const updated = useStore.getState().trades.find((item) => item.id === reviewCase.id)!
    assert(updated.sourceNoteHtml === '<p>新来源</p>', '软删除案例也必须同步')
    assert(updated.note === reviewCase.note, '来源同步不得覆盖案例正文')
    assert(updated.masteryState === reviewCase.masteryState, '来源同步不得改掌握状态')
    assert(updated.activities === reviewCase.activities, '来源同步不得创建案例活动')
  })
}

export function testCaseNoteNeverWritesBackOrCascades(): void {
  const source = trade('source', { note: '<p>来源</p>' })
  const first = trade('case-1', {
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    note: '<p>旧结论</p>',
  })
  const second = trade('case-2', {
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    note: '<p>第二个案例</p>',
  })
  withTrades([source, first, second], () => {
    useStore.getState().updateNote(first.id, '<p>新案例结论</p>')
    const state = useStore.getState()
    assert(state.trades.find((item) => item.id === source.id)?.note === source.note, '案例不得反写来源')
    assert(state.trades.find((item) => item.id === second.id)?.sourceNoteHtml === source.note, '案例不得级联其他案例')
    assert(state.trades.find((item) => item.id === first.id)?.note === '<p>新案例结论</p>', '案例必须保存自己的正文')
  })
}

export function testCreateCaseReturnsExplicitFailures(): void {
  const existingCase = trade('case', { tradeKind: 'case', sourceTradeId: 'source' })
  withTrades([existingCase], () => {
    const beforeMissing = useStore.getState().trades
    assert(useStore.getState().createReviewCaseFromTrade('missing').status === 'missing-source', '缺失来源结果错误')
    assert(useStore.getState().trades === beforeMissing, '缺失来源必须保持 trades 引用')
    const beforeCase = useStore.getState().trades
    assert(useStore.getState().createReviewCaseFromTrade(existingCase.id).status === 'source-is-case', '案例来源结果错误')
    assert(useStore.getState().trades === beforeCase, '案例再次提炼必须保持 trades 引用')
  })
}
