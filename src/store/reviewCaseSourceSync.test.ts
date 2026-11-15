import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { applySnapshotToStore } from '@/lib/snapshotStore'
import { buildUndoAction } from '@/lib/tradeUndo'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'

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
    useStore.setState({ trades: initial, starredIds: [], undoStack: [], redoStack: [] })
    run()
  } finally {
    useStore.setState(previous)
  }
}

function reviewCase(id: string, overrides: Partial<Trade> = {}): Trade {
  return trade(id, {
    ref: `CAS-${id}`,
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: '2026-08-14',
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    ...overrides,
  })
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

export function testSourceNoteUpdatesCaseSnapshotAndPreservesOwnedFields(): void {
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
    assert(updated.sourceNoteHtml === '<p>新来源</p>', '来源更新必须同步关联案例的来源正文')
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

export function testStoreCaseTypeMutationPreservesMasteryAndDateAndRefreshesMirrors(): void {
  const initial = reviewCase('case-type')
  withTrades([initial], () => {
    useStore.getState().updateTradeData(initial.id, { caseType: 'ambiguous' })

    const state = useStore.getState()
    const updated = state.trades[0]!
    assert(updated.caseType === 'ambiguous', '案例类型必须写入 store')
    assert(updated.masteryState === 'new', '仅修改案例类型不得改掌握状态')
    assert(updated.nextReviewAt === '2026-08-14', '仅修改案例类型不得改复看日期')
    assert(updated.reviewCategory === 'ambiguous', '案例类型变更必须刷新兼容分类')
    assert(updated.reviewStatus === 'unreviewed', '案例类型变更必须刷新兼容状态')
    assert(state.undoStack.length === 1, '一次分类 mutation 只能产生一个 undo action')
  })
}

export function testStoreMasteryAndDateMutationWritesOneCompatibleUndoObject(): void {
  const initial = reviewCase('mastery-date', {
    caseType: 'mistake',
    reviewCategory: 'mistake',
  })
  withTrades([initial], () => {
    useStore.getState().updateTradeData(initial.id, {
      masteryState: 'recheck',
      nextReviewAt: '2026-08-21',
    })

    const state = useStore.getState()
    const updated = state.trades[0]!
    assert(updated.masteryState === 'recheck', '掌握状态必须写入 store')
    assert(updated.nextReviewAt === '2026-08-21', '复看日期必须与掌握状态同次写入')
    assert(updated.reviewCategory === 'recheck', '兼容分类必须与掌握状态同次派生')
    assert(updated.reviewStatus === 'unreviewed', '兼容状态必须与掌握状态同次派生')
    assert(state.undoStack.length === 1, '掌握状态与日期必须共用一个 undo action')
    assert(
      state.undoStack[0]?.trades[0]?.fields.some(
        (field) => field.key === 'reviewCategory' && field.after === 'recheck',
      ),
      'undo 快照必须包含已规范化的兼容分类',
    )
  })
}

export function testLegacyFocusClassificationPromotesCasePriorityInAtomicStoreUpdate(): void {
  const initial = reviewCase('legacy-focus', {
    reviewCategory: 'focus',
    reviewStatus: 'focus',
  })
  withTrades([initial], () => {
    useStore.getState().updateTradeData(initial.id, { caseType: 'mistake' })

    const state = useStore.getState()
    const updated = state.trades[0]!
    assert(updated.isFocusCase === true, '旧版 focus 首次分类 mutation 必须同步升级为独立案例优先级')
    assert(!state.starredIds.includes(initial.id), '案例优先级不得写入交易星标')
    assert(updated.reviewCategory === 'mistake', '迁移优先级的同一状态更新必须规范化兼容分类')
    assert(updated.reviewStatus === 'unreviewed', '迁移优先级的同一状态更新必须规范化兼容状态')
    assert(state.undoStack.length === 1, '迁移优先级不得拆出额外的交易 undo action')

    assert(useStore.getState().undo(), '原有 updateTradeData undo 必须仍可用')
    assert(useStore.getState().trades[0]?.reviewCategory === 'focus', 'undo 必须恢复变更前的交易快照')
    assert(useStore.getState().redo(), '原有 updateTradeData redo 必须仍可用')
    assert(useStore.getState().trades[0]?.reviewCategory === 'mistake', 'redo 必须恢复规范化后的交易快照')
  })
}

export function testNonClassificationWritesPreserveLegacyFocusCase(): void {
  const source = trade('focus-source', { note: '<p>旧来源</p>' })
  const initial = reviewCase('focus-content', {
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    reviewCategory: 'focus',
    reviewStatus: 'focus',
  })
  withTrades([source, initial], () => {
    const assertFocus = (message: string) => {
      const current = useStore.getState().trades.find((item) => item.id === initial.id)!
      assert(current.reviewCategory === 'focus' && current.reviewStatus === 'focus', message)
      assert(!useStore.getState().starredIds.includes(initial.id), `${message}；非分类写入不得污染交易星标`)
    }

    useStore.getState().updateNote(initial.id, '<p>案例正文</p><img src="asset://case-image">')
    assertFocus('正文与图片变更必须保留 legacy focus')
    useStore.getState().updateNote(source.id, '<p>新来源</p>')
    assertFocus('来源快照级联必须保留 legacy focus')
    useStore.getState().addComment(initial.id, '保留关注')
    assertFocus('评论变更必须保留 legacy focus')
    useStore.getState().setTags(initial.id, ['重要'])
    assertFocus('标签变更必须保留 legacy focus')
    useStore.getState().updateTradeData(initial.id, { mistakeTags: ['冲动追单'] })
    assertFocus('错误标签变更必须保留 legacy focus')
  })
}

export function testSourceUndoRedoKeepsCaseConclusionIndependent(): void {
  const source = trade('source', { note: '<p>原正文</p>' })
  const own = reviewCase('own', { sourceTradeId: source.id, sourceNoteHtml: source.note, note: '<p>独立结论</p>' })
  const other = reviewCase('other', { sourceTradeId: 'missing', sourceNoteHtml: '<p>其他来源</p>' })
  withTrades([source, own, other], () => {
    useStore.getState().updateNote(source.id, '<p>最新正文</p><img src="journal-asset://new-source">')
    assert(useStore.getState().undoStack.length === 0, '来源同步不得额外创建全局撤销动作')
    const editedSource = useStore.getState().trades.find(t => t.id === source.id)!
    const action = buildUndoAction({ actionId: 'source-note-undo', label: '来源正文', createdAt: '2026-11-15T00:00:00.000Z', before: [source], after: [editedSource] })
    assert(action, '来源正文差异必须可以生成撤销补丁')
    useStore.setState({ undoStack: [action] })
    const getCase = () => useStore.getState().trades.find(t => t.id === own.id)!
    assert(getCase().sourceNoteHtml?.includes('new-source'), '字段编辑必须同步文字和图片')
    assert(useStore.getState().undoStack.length === 1, '同步来源不得增加额外撤销动作')
    useStore.getState().updateNote(own.id, '<p>同步后继续写的结论</p>')
    assert(useStore.getState().undo(), '来源字段变更必须可撤销')
    assert(getCase().sourceNoteHtml === source.note, '撤销后来源与案例必须一致')
    assert(getCase().note === '<p>同步后继续写的结论</p>', '撤销来源不得抹掉后写的案例结论')
    assert(useStore.getState().redo(), '来源字段变更必须可重做')
    assert(getCase().sourceNoteHtml?.includes('new-source'), '重做后案例必须恢复最新来源')
    assert(useStore.getState().trades.find(t => t.id === other.id) === other, '不相关案例不得被改写')
  })
}

export function testBatchSourceUpsertUsesFinalNoteForEveryLinkedCase(): void {
  const source = trade('batch-source', { note: '<p>原正文</p>' })
  const first = reviewCase('first', { sourceTradeId: source.id, sourceNoteHtml: source.note, note: '<p>第一个结论</p>' })
  const second = reviewCase('second', { sourceTradeId: source.id, sourceNoteHtml: source.note, deletedAt: '2026-08-01T00:00:00.000Z' })
  withTrades([source, first, second], () => {
    useStore.getState().upsertTradesFromNonInteractiveImport([
      { ...source, note: '<p>中间值</p>' },
      { ...first, sourceNoteHtml: '<p>导入的旧快照</p>' },
      { ...source, note: '<p>最后值</p><img src="journal-asset://batch-image">' },
    ])
    const state = useStore.getState()
    const latest = state.trades.find(t => t.id === source.id)!
    for (const item of [first, second]) {
      const current = state.trades.find(t => t.id === item.id)!
      assert(current.sourceNoteHtml === latest.note, '批量最终来源必须一次同步所有关联案例，含回收站案例')
      assert(current.note === item.note && current.deletedAt === item.deletedAt, '同步不得覆盖独立正文或删除状态')
    }
  })
}

export function testClearingSourceNoteClearsCaseSourceWithoutErasingConclusion(): void {
  const source = trade('clear-source', { note: '<p>待清空</p>' })
  const own = reviewCase('clear-case', { sourceTradeId: source.id, sourceNoteHtml: source.note, note: '<p>保留结论</p>' })
  withTrades([source, own], () => {
    useStore.getState().updateNote(source.id, '')
    const current = useStore.getState().trades.find(t => t.id === own.id)!
    assert(current.sourceNoteHtml === '', '清空来源是有效更新，不能退回旧快照')
    assert(current.note === own.note, '清空来源不得清空案例结论')
  })
}

export function testHydratingExistingLibraryRefreshesStaleCaseSources(): void {
  const previous = useStore.getState()
  const snapshot = createEmptyPersistedSnapshot()
  const source = trade('existing-source', { liveStageId: snapshot.currentLiveStageId, note: '<p>资料库中已经修改的来源</p><img src="journal-asset://existing-new">' })
  const own = reviewCase('existing-case', { liveStageId: snapshot.currentLiveStageId, sourceTradeId: source.id, sourceNoteHtml: '<p>过期副本</p>', note: '<p>既有独立结论</p>' })
  snapshot.trades = [source, own]
  try {
    applySnapshotToStore(snapshot)
    const current = useStore.getState().trades.find(t => t.id === own.id)!
    assert(current.sourceNoteHtml === source.note, '既有案例载入后必须自动跟随原日志，不要求重新提炼或再次编辑')
    assert(current.note === own.note, '载入修复不得覆盖既有独立结论')
    assert(snapshot.trades[1] === own && own.sourceNoteHtml === '<p>过期副本</p>', '载入投影不得篡改待验证归档或传入快照')
  } finally { useStore.setState(previous) }
}
