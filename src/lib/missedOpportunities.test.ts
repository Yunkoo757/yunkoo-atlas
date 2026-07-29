import type { Trade } from '@/data/trades'
import {
  buildMissedOpportunitySummary,
  filterMissedOpportunityItems,
  parseMissedOpportunityFilters,
  type MissedOpportunitySource,
} from '@/lib/missedOpportunities'
import { createBusinessDateAnchor } from '@/lib/periods'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-id',
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'missed',
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
    openedAt: '2026-07-20T09:00:00.000Z',
    closedAt: '2026-07-20T12:00:00.000Z',
    note: '',
    ...overrides,
  }
}

export function testSummaryUsesOnlyTheStrictMissedSourceMatches(): void {
  const live = trade({ id: 'live', tradeKind: 'live' })
  const paper = trade({ id: 'paper', tradeKind: 'paper' })
  const reviewCase = trade({ id: 'case', tradeKind: 'case', caseType: 'missed', recordedAt: '2026-07-21T12:00:00.000Z' })
  const records = [
    live,
    paper,
    reviewCase,
    trade({ id: 'live-win', tradeKind: 'live', status: 'win' }),
    trade({ id: 'ordinary-case', tradeKind: 'case', caseType: 'mistake' }),
    trade({ id: 'deleted', tradeKind: 'paper', deletedAt: '2026-07-21T00:00:00.000Z' }),
  ]
  const combinations: MissedOpportunitySource[][] = [
    ['trade'], ['paper'], ['case'],
    ['trade', 'paper'], ['trade', 'case'], ['paper', 'case'],
    ['trade', 'paper', 'case'],
  ]

  for (const sources of combinations) {
    const summary = buildMissedOpportunitySummary(records, sources)
    const expected = sources.length
    assert(summary.items.length === expected, `${sources.join('+')} 聚合数量错误`)
    assert(summary.rawTotal === expected, `${sources.join('+')} 原始数量错误`)
    assert(summary.items.every((item) => sources.includes(item.source)), `${sources.join('+')} 不得包含未选来源`)
  }
}

export function testSummaryMergesOnlyExplicitSourceTradeRelationships(): void {
  const root = trade({ id: 'root', closedAt: '2026-07-20T12:00:00.000Z' })
  const linkedCase = trade({ id: 'linked', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id, recordedAt: '2026-07-22T12:00:00.000Z' })
  const secondLinkedCase = trade({ id: 'linked-older', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id, recordedAt: '2026-07-21T12:00:00.000Z' })
  const unrelatedCase = trade({ id: 'unrelated', tradeKind: 'case', caseType: 'missed', recordedAt: root.closedAt! })

  const merged = buildMissedOpportunitySummary([root, linkedCase, secondLinkedCase], ['trade', 'case'])
  assert(merged.items.length === 1, '明确来源关系应合并成一个聚合项')
  assert(merged.items[0]?.linkedCases[0]?.id === linkedCase.id, '合并项必须保留案例入口')
  assert(merged.items[0]?.linkedCases.map((item) => item.id).join(',') === 'linked,linked-older', '多个关联案例必须按记录时间倒序保留')

  const unrelated = buildMissedOpportunitySummary([root, unrelatedCase], ['trade', 'case'])
  assert(unrelated.items.length === 2, '同品种同方向同时间但无 sourceTradeId 时不得合并')
}

export function testSummaryKeepsExcludedAndDeletedOriginsDistinct(): void {
  const root = trade({ id: 'root' })
  const linkedCase = trade({ id: 'linked', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id })
  const deletedSource = trade({ id: 'deleted-source', deletedAt: '2026-07-22T00:00:00.000Z' })
  const deletedLinkedCase = trade({ id: 'deleted-linked', tradeKind: 'case', caseType: 'missed', sourceTradeId: deletedSource.id })
  const caseDeleted = trade({ id: 'case-deleted', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id, deletedAt: '2026-07-22T00:00:00.000Z' })

  const excludedOrigin = buildMissedOpportunitySummary([root, linkedCase], ['case'])
  assert(excludedOrigin.items.some((item) => item.primary.id === linkedCase.id), '未包含来源不得被后台拉入')
  assert(excludedOrigin.items[0]?.missingSourceId === undefined, '仍存在但未包含的来源不得标记删除')

  const deletedOrigin = buildMissedOpportunitySummary([deletedSource, deletedLinkedCase], ['case'])
  assert(deletedOrigin.items[0]?.missingSourceId === deletedSource.id, '来源删除后案例必须显示失效追溯')

  const caseDeletedSummary = buildMissedOpportunitySummary([root, caseDeleted], ['trade', 'case'])
  assert(caseDeletedSummary.items[0]?.linkedCases.length === 0, '案例删除后根项必须退化为普通项')
}

export function testSummaryTreatsEmptyDeletedAtAsDeleted(): void {
  const emptyDeleted = trade({ id: 'empty-deleted', deletedAt: '' })
  const summary = buildMissedOpportunitySummary([emptyDeleted], ['trade'])
  assert(summary.items.length === 0 && summary.rawTotal === 0, 'deletedAt 为空字符串的命中记录也必须排除')
}

export function testSummaryMarksEmptyDeletedAtSourceAsMissing(): void {
  const emptyDeletedSource = trade({ id: 'empty-deleted-source', deletedAt: '' })
  const linkedCase = trade({
    id: 'linked-to-empty-deleted',
    tradeKind: 'case',
    caseType: 'missed',
    sourceTradeId: emptyDeletedSource.id,
  })
  const summary = buildMissedOpportunitySummary([emptyDeletedSource, linkedCase], ['case'])
  assert(summary.items[0]?.missingSourceId === emptyDeletedSource.id, '全量来源 deletedAt 为空字符串时案例必须标记失效追溯')
}

export function testSummarySortsByBusinessOccurrenceThenEnglishKey(): void {
  const laterCase = trade({ id: 'z-case', tradeKind: 'case', caseType: 'missed', recordedAt: '2026-07-22T08:00:00.000Z' })
  const sameTimeB = trade({ id: 'b-live', closedAt: '2026-07-21T08:00:00.000Z' })
  const sameTimeA = trade({ id: 'a-paper', tradeKind: 'paper', closedAt: '2026-07-21T08:00:00.000Z' })
  const summary = buildMissedOpportunitySummary([sameTimeB, laterCase, sameTimeA], ['trade', 'paper', 'case'])
  assert(summary.items.map((item) => item.key).join(',') === 'z-case,a-paper,b-live', '聚合项必须按业务时间倒序并以英文 key 稳定排序')
}

export function testTemporaryPeriodFilterUsesBusinessDateAnchor(): void {
  const live = trade({ id: 'today', symbol: 'BTCUSDT', side: 'long', missReason: 'hesitation', closedAt: '2026-07-20T03:30:00.000Z' })
  const paper = trade({ id: 'other', tradeKind: 'paper', symbol: 'ETHUSDT', side: 'short', missReason: 'no_alert', closedAt: '2026-07-19T12:00:00.000Z' })
  const summary = buildMissedOpportunitySummary([paper, live], ['trade', 'paper'])
  const anchor = createBusinessDateAnchor(new Date(2026, 6, 21, 3, 59, 59), 4)
  const filtered = filterMissedOpportunityItems(summary.items, { period: 'today' }, anchor)
  assert(filtered.map((item) => item.primary.id).join(',') === 'today', '日期筛选必须按交易日锚点过滤 occurredAt')
  assert(summary.rawCounts.trade === 1 && summary.rawCounts.paper === 1 && summary.rawTotal === 2, '临时筛选不得改写原始计数')
}

export function testTemporarySymbolFilterUsesPrimary(): void {
  const summary = buildMissedOpportunitySummary([
    trade({ id: 'btc', symbol: 'BTCUSDT' }),
    trade({ id: 'eth', tradeKind: 'paper', symbol: 'ETHUSDT' }),
  ], ['trade', 'paper'])
  const result = filterMissedOpportunityItems(summary.items, { symbol: 'BTCUSDT' }, createBusinessDateAnchor())
  assert(result.map((item) => item.primary.id).join(',') === 'btc', '品种筛选必须只检查聚合项 primary')
}

export function testTemporarySideFilterUsesPrimary(): void {
  const summary = buildMissedOpportunitySummary([
    trade({ id: 'long', side: 'long' }),
    trade({ id: 'short', tradeKind: 'paper', side: 'short' }),
  ], ['trade', 'paper'])
  const result = filterMissedOpportunityItems(summary.items, { side: 'short' }, createBusinessDateAnchor())
  assert(result.map((item) => item.primary.id).join(',') === 'short', '方向筛选必须只检查聚合项 primary')
}

export function testTemporaryMissReasonFilterUsesPrimary(): void {
  const summary = buildMissedOpportunitySummary([
    trade({ id: 'hesitation', missReason: 'hesitation' }),
    trade({ id: 'alert', tradeKind: 'paper', missReason: 'no_alert' }),
  ], ['trade', 'paper'])
  const result = filterMissedOpportunityItems(summary.items, { missReason: 'no_alert' }, createBusinessDateAnchor())
  assert(result.map((item) => item.primary.id).join(',') === 'alert', '错过原因筛选必须只检查聚合项 primary')
}

export function testParseTemporaryFiltersIgnoresUnknownValues(): void {
  const parsed = parseMissedOpportunityFilters('?period=today&symbol=BTCUSDT&side=long&missReason=hesitation')
  assert(parsed.period === 'today' && parsed.symbol === 'BTCUSDT' && parsed.side === 'long' && parsed.missReason === 'hesitation', '合法 URL 筛选值必须保留')
  const unknown = parseMissedOpportunityFilters('?period=forever&side=flat&missReason=unknown&symbol=ETHUSDT')
  assert(unknown.period === undefined && unknown.side === undefined && unknown.missReason === undefined && unknown.symbol === 'ETHUSDT', '未知枚举筛选值必须忽略')
}
