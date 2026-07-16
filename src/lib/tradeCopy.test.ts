import type { Trade } from '@/data/trades'
import { formatYmd } from '@/lib/periods'
import { computeStrategyStats } from '@/lib/strategies'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
import { useStore } from '@/store/useStore'

const now = new Date('2026-07-16T08:30:00.000Z')

const liveSource: Trade = {
  id: 'live-source',
  ref: 'TRD-9',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'high',
  strategyId: 'strategy-1',
  session: 'London Open',
  timeframe: '4H',
  narrative: 'Bullish',
  psychology: 'Neutral',
  tags: ['突破', '顺势'],
  mistakeTags: ['追单'],
  reviewStatus: 'reviewed',
  reviewedAt: '2026-07-15T09:00:00.000Z',
  reviewCategory: 'mistake',
  tradeKind: 'live',
  sourceTradeId: 'legacy-source',
  caseType: 'mistake',
  masteryState: 'mastered',
  nextReviewAt: '2026-07-20',
  entry: 100,
  exit: 110,
  stopLoss: 95,
  initialStopLoss: 95,
  size: 2,
  pnl: 200,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-07-01',
  recordedAt: '2026-07-01T08:00:00.000Z',
  closedAt: '2026-07-02',
  missReason: 'hesitation',
  note: '<p>等待回踩后入场</p>',
  comments: [{ id: 'comment-1', text: '旧评论', createdAt: '2026-07-02' }],
  activities: [{ id: 'activity-1', kind: 'status', timestamp: '2026-07-02', status: 'win' }],
  deletedAt: '2026-07-15T00:00:00.000Z',
  deletedBy: 'batch',
}

const paperSource: Trade = {
  ...liveSource,
  id: 'paper-source',
  ref: 'TRD-3',
  tradeKind: 'paper',
  pnl: -50,
  rMultiple: -1,
  status: 'loss',
  deletedAt: undefined,
  deletedBy: undefined,
}

const caseSource: Trade = {
  ...liveSource,
  id: 'case-source',
  ref: 'CAS-4',
  tradeKind: 'case',
  sourceTradeId: 'origin-trade',
  caseType: 'exemplar',
  masteryState: 'mastered',
  nextReviewAt: null,
  deletedAt: undefined,
  deletedBy: undefined,
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function idFactory(prefix = 'copy'): () => string {
  let index = 0
  return () => `${prefix}-${++index}`
}

export function testAccountCopyKeepsPlanInputsAndClearsHistoricalState(): void {
  const sourceSnapshot = JSON.stringify(liveSource)
  const [copy] = buildSafeTradeCopies([liveSource], [liveSource, caseSource], {
    now,
    createId: idFactory(),
  })

  assert(copy?.id === 'copy-1' && copy.ref === 'TRD-10', '账户副本必须使用新 ID 和连续 TRD 编号')
  assert(copy.status === 'planned' && copy.tradeKind === 'live', '实盘副本必须成为同类型新计划')
  assert(copy.openedAt === formatYmd(now), '计划日期必须来自注入的 now')
  assert(copy.recordedAt === now.toISOString(), '收录时间必须来自注入的 now')
  assert(copy.exit === null && copy.closedAt === null, '新计划不得保留平仓信息')
  assert(copy.pnl === null && copy.rMultiple === null, '新计划不得保留历史结果')
  assert(copy.resultSource === undefined && copy.initialStopLoss === null, '新计划不得保留结果依据和冻结风险')
  assert(copy.reviewStatus === 'unreviewed' && copy.reviewCategory === 'normal', '新计划必须重新进入普通待复盘状态')
  assert(copy.reviewedAt === null && copy.mistakeTags.length === 0, '新计划不得继承已完成复盘或错误标签')
  assert(copy.comments?.length === 0 && copy.activities?.length === 0, '新计划不得继承评论与活动历史')
  assert(!copy.deletedAt && !copy.deletedBy, '新计划不得继承删除状态')
  assert(
    copy.sourceTradeId === undefined && copy.caseType === undefined &&
      copy.masteryState === undefined && copy.nextReviewAt === undefined,
    '账户副本不得继承案例字段',
  )
  assert(copy.missReason === undefined, '新计划不得继承错过原因')
  assert(
    copy.entry === liveSource.entry && copy.stopLoss === liveSource.stopLoss && copy.size === liveSource.size,
    '新计划必须保留入场、止损与仓位计划',
  )
  assert(
    copy.strategyId === liveSource.strategyId && copy.symbol === liveSource.symbol &&
      copy.side === liveSource.side && copy.timeframe === liveSource.timeframe,
    '新计划必须保留策略、品种、方向与周期',
  )
  assert(copy.note === '', '新计划不得继承历史复盘正文')
  assert(copy.tags !== liveSource.tags, '保留的标签数组必须深拷贝')
  copy.tags.push('副本标签')
  assert(!liveSource.tags.includes('副本标签'), '修改副本标签不得污染源交易')
  assert(JSON.stringify(liveSource) === sourceSnapshot, '创建副本不得修改源对象')
}

export function testMixedBatchAllocatesIndependentSequentialRefsWithoutCollisions(): void {
  const secondCase: Trade = { ...caseSource, id: 'case-source-2', ref: 'CAS-2' }
  const copies = buildSafeTradeCopies(
    [liveSource, caseSource, paperSource, secondCase],
    [liveSource, paperSource, caseSource, { ...paperSource, id: 'existing-12', ref: 'TRD-12' }],
    { now, createId: idFactory('mixed') },
  )

  assert(
    copies.map((trade) => trade.ref).join(',') === 'TRD-13,CAS-5,TRD-14,CAS-6',
    '混合批次必须分别连续分配 TRD 与 CAS 编号',
  )
  assert(new Set(copies.map((trade) => trade.ref)).size === copies.length, '同批副本编号不得重复')
  assert(
    copies.map((trade) => trade.id).join(',') === 'mixed-1,mixed-2,mixed-3,mixed-4',
    '每个副本必须调用一次注入的 ID 生成器',
  )
}

export function testCaseCopyPreservesKnowledgeProvenanceButStaysOutOfPerformance(): void {
  const before = computeStrategyStats([liveSource], liveSource.strategyId)
  const [copy] = buildSafeTradeCopies([caseSource], [liveSource, caseSource], {
    now,
    createId: idFactory('case-copy'),
  })
  assert(copy?.tradeKind === 'case' && copy.ref === 'CAS-5', '案例副本必须保持案例类型和 CAS 编号')
  assert(copy.sourceTradeId === caseSource.sourceTradeId, '案例副本必须保留原始交易追溯')
  assert(copy.caseType === caseSource.caseType && copy.note === caseSource.note, '案例副本必须保留案例类型和正文')
  assert(copy.masteryState === 'new' && copy.nextReviewAt === null, '案例副本必须回到未排期的新案例')
  assert(copy.reviewStatus === 'unreviewed' && copy.reviewCategory === caseSource.reviewCategory, '案例副本必须待复盘并保留知识分类')
  assert(copy.reviewedAt === null && copy.mistakeTags.join(',') === caseSource.mistakeTags.join(','), '案例副本必须重置完成时间并保留错误知识')
  assert(copy.comments?.length === 0 && copy.activities?.length === 0, '案例副本不得继承评论与活动历史')
  assert(!copy.deletedAt && !copy.deletedBy, '案例副本不得继承删除状态')
  assert(copy.recordedAt === now.toISOString(), '案例副本收录时间必须来自注入的 now')
  assert(copy.tags !== caseSource.tags, '案例标签数组必须深拷贝')
  assert(copy.mistakeTags !== caseSource.mistakeTags, '案例错误标签数组必须深拷贝')

  const after = computeStrategyStats([liveSource, copy], liveSource.strategyId)
  assert(JSON.stringify(after) === JSON.stringify(before), '复制案例不得改变任何策略统计指标')
}

export function testAccountCopiesDoNotDuplicateClosedPerformanceAndCommitOnce(): void {
  const previous = useStore.getState()
  const strategyId = previous.strategies[0]?.id ?? 'uncategorized'
  const closedLive = { ...liveSource, id: 'stats-live', strategyId, deletedAt: undefined, deletedBy: undefined }
  const closedPaper = { ...paperSource, id: 'stats-paper', strategyId }
  const sources = [closedLive, closedPaper]
  const copies = buildSafeTradeCopies(sources, sources, { now, createId: idFactory('stats-copy') })
  const before = computeStrategyStats(sources, strategyId)
  const after = computeStrategyStats([...sources, ...copies], strategyId)

  assert(after.closedCount === before.closedCount, '复制为计划不得增加已平仓样本')
  assert(after.evaluatedCount === before.evaluatedCount, '复制为计划不得增加已评估结果')
  assert(after.winRate === before.winRate, '复制为计划不得改写胜率')
  assert(after.totalPnl === before.totalPnl && after.totalR === before.totalR, '复制为计划不得重复累计收益')
  assert(after.averageR === before.averageR, '复制为计划不得改写平均 R')

  let commits = 0
  const unsubscribe = useStore.subscribe(() => {
    commits += 1
  })
  try {
    useStore.setState({ trades: sources })
    commits = 0
    useStore.getState().upsertTrades(copies)
    assert(commits === 1, '批量安全复制必须只触发一次 store 更新')
  } finally {
    unsubscribe()
    useStore.setState({
      trades: previous.trades,
      symbolCatalog: previous.symbolCatalog,
      tagPresets: previous.tagPresets,
      mistakeTagPresets: previous.mistakeTagPresets,
    })
  }
}

export function testExplicitlyUnscheduledCaseSurvivesStoreNormalization(): void {
  const previous = useStore.getState()
  const strategyId = previous.strategies[0]?.id ?? 'uncategorized'
  const source = { ...caseSource, strategyId }
  const [copy] = buildSafeTradeCopies([source], [source], { now, createId: idFactory('case-store') })
  try {
    useStore.setState({ trades: [] })
    useStore.getState().upsertTrades([copy])
    assert(
      useStore.getState().trades[0]?.nextReviewAt === null,
      '明确设为 null 的案例副本不得被 store 自动改成排期日期',
    )
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testDuplicateGeneratedIdRejectsWholeBatchBeforeCommit(): void {
  let failed = false
  try {
    buildSafeTradeCopies([liveSource, paperSource], [liveSource, paperSource], {
      now,
      createId: () => 'live-source',
    })
  } catch (error) {
    failed = error instanceof Error && error.message.includes('ID')
  }
  assert(failed, 'ID 冲突必须在生成整批副本时直接拒绝')
}
