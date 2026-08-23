import type { Trade } from '@/data/trades'
import {
  DEFAULT_REVIEW_POOL_LAYOUT,
  buildCustomReviewPool,
  buildReviewPoolCandidateIndex,
  buildSystemReviewPool,
  normalizeReviewPoolLayout,
  type ReviewPoolFilters,
} from '@/lib/reviewPools'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const baseTrade: Extract<Trade, { tradeKind: 'live' }> = {
  id: 'live-win',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  liveStageId: 'stage-current',
  tags: ['趋势'],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-08-01T00:00:00.000Z',
  closedAt: '2026-08-02T00:00:00.000Z',
  note: '<p>有效正文</p>',
}

const trades: Trade[] = [
  baseTrade,
  { ...baseTrade, id: 'live-loss', ref: 'TRD-2', status: 'loss', side: 'short', pnl: -50, rMultiple: -1 },
  { ...baseTrade, id: 'paper-missed', ref: 'SIM-1', tradeKind: 'paper', status: 'missed', liveStageId: undefined } as Trade,
  { ...baseTrade, id: 'live-open', ref: 'TRD-3', status: 'open', exit: null, closedAt: null, pnl: null, rMultiple: null },
  {
    ...baseTrade,
    id: 'case-loss',
    ref: 'CAS-1',
    tradeKind: 'case',
    status: 'loss',
    caseType: 'mistake',
    masteryState: 'new',
    note: '',
    sourceNoteHtml: '<p>冻结来源正文</p>',
  },
  {
    ...baseTrade,
    id: 'case-missed',
    ref: 'CAS-2',
    tradeKind: 'case',
    status: 'win',
    caseType: 'missed',
    masteryState: 'new',
  },
  { ...baseTrade, id: 'deleted-case', ref: 'CAS-3', tradeKind: 'case', caseType: 'exemplar', deletedAt: '2026-08-03T00:00:00.000Z' },
]

const noLimits: ReviewPoolFilters = {
  sources: [],
  results: [],
  caseTypes: [],
  strategyIds: [],
  symbols: [],
  sides: [],
  tags: [],
  mistakeTags: [],
  requireContent: false,
}

export function testSystemReviewPoolsUseStableEligibility(): void {
  const all = buildSystemReviewPool(trades, 'all', new Set())
  assert(
    all.map((trade) => trade.id).join(',') === 'live-win,live-loss,paper-missed,case-loss,case-missed',
    '全部内容应包含全部有效案例与已结束/错过日志，并排除持仓和删除记录',
  )
  assert(
    buildSystemReviewPool(trades, 'losses', new Set()).map((trade) => trade.id).join(',') === 'live-loss',
    '亏损日志系统池不得把亏损案例混入日志池',
  )
  assert(
    buildSystemReviewPool(trades, 'missed', new Set()).map((trade) => trade.id).join(',') === 'paper-missed,case-missed',
    '错过机会必须合并日志 status 与案例 caseType 两条分支',
  )
  assert(
    buildSystemReviewPool(trades, 'boosted', new Set(['live-open', 'case-loss'])).map((trade) => trade.id).join(',') === 'case-loss',
    '近期多看不得放宽持仓记录的通用候选资格',
  )
}

export function testCustomReviewPoolEmptyArraysAndAndOrSemantics(): void {
  assert(buildCustomReviewPool(trades, noLimits).length === 5, '空数组必须表示不限制而不是无匹配')

  const mixed = buildCustomReviewPool(trades, {
    ...noLimits,
    sources: ['live', 'paper'],
    results: ['loss', 'missed'],
  })
  assert(
    mixed.map((trade) => trade.id).join(',') === 'live-loss,paper-missed',
    '同一数组内应 OR、不同筛选维度间应 AND',
  )

  const caseResult = buildCustomReviewPool(trades, { ...noLimits, results: ['loss'] })
  assert(
    caseResult.map((trade) => trade.id).join(',') === 'live-loss,case-loss',
    '结果筛选必须使用案例保留的规范 status',
  )

  const caseType = buildCustomReviewPool(trades, { ...noLimits, caseTypes: ['mistake'] })
  assert(
    caseType.map((trade) => trade.id).join(',') === 'case-loss',
    'caseTypes 非空时必须排除非案例来源',
  )
}

export function testCustomReviewPoolStableFieldsAndContent(): void {
  const matched = buildCustomReviewPool(trades, {
    ...noLimits,
    strategyIds: ['strategy-1'],
    symbols: ['BTCUSDT'],
    sides: ['short'],
  })
  assert(matched.map((trade) => trade.id).join(',') === 'live-loss', '稳定字段必须按维度收窄')

  const content = buildCustomReviewPool(trades, { ...noLimits, sources: ['case'], requireContent: true })
  assert(
    content.map((trade) => trade.id).join(',') === 'case-loss,case-missed',
    '案例有效正文应包含自身正文或冻结来源正文',
  )
}

export function testReviewPoolCandidateIndexSharesOneCanonicalDerivation(): void {
  const filters = { ...noLimits, sources: ['live'] as const, results: ['loss'] as const }
  const preset = {
    id: 'custom-losses',
    name: '实盘亏损',
    filters: { ...filters, sources: [...filters.sources], results: [...filters.results] },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
  const subscribed = new Set(['case-loss', 'live-open'])
  const index = buildReviewPoolCandidateIndex(trades, [preset], { subscribedIds: subscribed })
  assert(
    index.system.all.map((trade) => trade.id).join(',') === buildSystemReviewPool(trades, 'all', subscribed).map((trade) => trade.id).join(','),
    '共享索引的系统池必须与单池规范结果一致',
  )
  assert(
    index.custom.get(preset.id)?.map((trade) => trade.id).join(',') === buildCustomReviewPool(trades, preset.filters).map((trade) => trade.id).join(','),
    '共享索引的自定义池必须与单池规范结果一致',
  )
}

export function testReviewPoolLayoutNormalization(): void {
  const defaults = normalizeReviewPoolLayout(undefined, [])
  assert(
    JSON.stringify(defaults) === JSON.stringify(DEFAULT_REVIEW_POOL_LAYOUT),
    '缺失布局必须恢复六个系统池默认顺序',
  )

  const normalized = normalizeReviewPoolLayout({
    homeOrder: [
      { kind: 'custom', id: 'custom-1' },
      { kind: 'system', id: 'missed' },
      { kind: 'system', id: 'all' },
      { kind: 'system', id: 'missed' },
      { kind: 'custom', id: 'deleted' },
      { kind: 'system', id: 'wins' },
      { kind: 'system', id: 'losses' },
      { kind: 'system', id: 'cases' },
      { kind: 'system', id: 'boosted' },
    ],
    hiddenSystemIds: ['missed', 'all' as 'missed'],
  }, ['custom-1'])

  assert(normalized.homeOrder[0]?.kind === 'system' && normalized.homeOrder[0].id === 'all', 'all 必须恒为首页第一项')
  assert(!normalized.homeOrder.some((item) => item.id === 'missed'), '隐藏系统池必须优先从 homeOrder 移除')
  assert(!normalized.homeOrder.some((item) => item.id === 'deleted'), '已删除自定义引用必须清理')
  assert(normalized.homeOrder.length === 6, '首页顺序最多规范化为六项')
  assert(normalized.hiddenSystemIds.join(',') === 'missed', 'all 不得进入隐藏集合')
}
