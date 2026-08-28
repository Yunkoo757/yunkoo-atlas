import type { Trade } from '@/data/trades'
import {
  buildMissedOpportunitySummary,
  filterMissedOpportunityItems,
  isMissedOpportunityDeleted,
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
  const combinations: MissedOpportunitySource[][] = [['trade'], ['paper'], ['trade', 'paper']]

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

  const merged = buildMissedOpportunitySummary([root, linkedCase, secondLinkedCase], ['trade'])
  assert(merged.items.length === 1, '明确来源关系应合并成一个聚合项')
  assert(merged.items[0]?.linkedCases[0]?.id === linkedCase.id, '合并项必须保留案例入口')
  assert(merged.items[0]?.linkedCases.map((item) => item.id).join(',') === 'linked,linked-older', '多个关联案例必须按记录时间倒序保留')

  const unrelated = buildMissedOpportunitySummary([root, unrelatedCase], ['trade'])
  assert(unrelated.items.length === 1, '无来源关系的案例不得成为第二条错过事件')
  assert(unrelated.items[0]?.linkedCases.length === 0, '无来源关系的案例不得错误关联')
}

export function testSummaryOnlyLinksCasesToVisibleOrigins(): void {
  const root = trade({ id: 'root' })
  const linkedCase = trade({ id: 'linked', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id })
  const deletedSource = trade({ id: 'deleted-source', deletedAt: '2026-07-22T00:00:00.000Z' })
  const caseDeleted = trade({ id: 'case-deleted', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id, deletedAt: '2026-07-22T00:00:00.000Z' })

  const excludedOrigin = buildMissedOpportunitySummary([root, linkedCase], ['paper'])
  assert(excludedOrigin.items.length === 0, '未包含的原始记录与其案例不得进入聚合页')

  const deletedOrigin = buildMissedOpportunitySummary([deletedSource, linkedCase], ['trade'])
  assert(deletedOrigin.items.length === 0, '来源删除后不得让案例替代原始错过事件')

  const caseDeletedSummary = buildMissedOpportunitySummary([root, caseDeleted], ['trade'])
  assert(caseDeletedSummary.items[0]?.linkedCases.length === 0, '案例删除后根项必须退化为普通项')
}

export function testSummaryTreatsEmptyDeletedAtAsDeleted(): void {
  const emptyDeleted = trade({ id: 'empty-deleted', deletedAt: '' })
  const summary = buildMissedOpportunitySummary([emptyDeleted], ['trade'])
  assert(isMissedOpportunityDeleted(emptyDeleted), 'deletedAt 为空字符串也必须视为软删除')
  assert(summary.items.length === 0 && summary.rawTotal === 0, 'deletedAt 为空字符串的命中记录也必须排除')
}

export function testSummaryDoesNotPromoteCaseWhenSourceIsDeleted(): void {
  const emptyDeletedSource = trade({ id: 'empty-deleted-source', deletedAt: '' })
  const linkedCase = trade({
    id: 'linked-to-empty-deleted',
    tradeKind: 'case',
    caseType: 'missed',
    sourceTradeId: emptyDeletedSource.id,
  })
  const summary = buildMissedOpportunitySummary([emptyDeletedSource, linkedCase], ['trade'])
  assert(summary.items.length === 0, '来源被删除后，关联案例不得升级为独立错过事件')
}

export function testSummarySortsByBusinessOccurrenceThenEnglishKey(): void {
  const sameTimeB = trade({ id: 'b-live', closedAt: '2026-07-21T08:00:00.000Z' })
  const sameTimeA = trade({ id: 'a-paper', tradeKind: 'paper', closedAt: '2026-07-21T08:00:00.000Z' })
  const summary = buildMissedOpportunitySummary([sameTimeB, sameTimeA], ['trade', 'paper'])
  assert(summary.items.map((item) => item.key).join(',') === 'a-paper,b-live', '聚合项必须按业务时间倒序并以英文 key 稳定排序')
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

export function testTemporaryOtherMissReasonFilterIncludesMissingReason(): void {
  const summary = buildMissedOpportunitySummary([
    trade({ id: 'missing-reason', missReason: undefined }),
    trade({ id: 'hesitation', tradeKind: 'paper', missReason: 'hesitation' }),
  ], ['trade', 'paper'])
  const result = filterMissedOpportunityItems(summary.items, { missReason: 'other' }, createBusinessDateAnchor())
  assert(result.map((item) => item.primary.id).join(',') === 'missing-reason', '未填写的错过原因在“其他”筛选下必须命中')
}

export function testParseTemporaryFiltersIgnoresUnknownValues(): void {
  const parsed = parseMissedOpportunityFilters('?period=today&symbol=BTCUSDT&side=long&missReason=hesitation')
  assert(parsed.period === 'today' && parsed.symbol === 'BTCUSDT' && parsed.side === 'long' && parsed.missReason === 'hesitation', '合法 URL 筛选值必须保留')
  const unknown = parseMissedOpportunityFilters('?period=forever&side=flat&missReason=unknown&symbol=ETHUSDT')
  assert(unknown.period === undefined && unknown.side === undefined && unknown.missReason === undefined && unknown.symbol === 'ETHUSDT', '未知枚举筛选值必须忽略')
}
