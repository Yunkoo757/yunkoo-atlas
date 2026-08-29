import type { Trade } from '@/data/trades'
import {
  buildMissedOpportunitySummary,
  isMissedOpportunityDeleted,
  type MissedOpportunitySource,
} from '@/lib/missedOpportunities'

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

export function testSummaryUsesOnlyStrictMissedSources(): void {
  const records = [
    trade({ id: 'live' }),
    trade({ id: 'paper', tradeKind: 'paper' }),
    trade({ id: 'live-win', status: 'win' }),
    trade({ id: 'deleted', tradeKind: 'paper', deletedAt: '2026-07-21T00:00:00.000Z' }),
  ]
  const combinations: MissedOpportunitySource[][] = [['trade'], ['paper'], ['trade', 'paper']]
  for (const sources of combinations) {
    const summary = buildMissedOpportunitySummary(records, sources)
    assert(summary.items.length === sources.length, `${sources.join('+')} 聚合数量错误`)
    assert(summary.rawTotal === sources.length, `${sources.join('+')} 原始数量错误`)
  }
}

export function testSummaryMergesOnlyExplicitCaseRelationships(): void {
  const root = trade({ id: 'root' })
  const linked = trade({ id: 'linked', tradeKind: 'case', caseType: 'missed', sourceTradeId: root.id })
  const unrelated = trade({ id: 'unrelated', tradeKind: 'case', caseType: 'missed' })
  const summary = buildMissedOpportunitySummary([root, linked, unrelated], ['trade'])
  assert(summary.items.length === 1, '案例不得成为独立错过事件')
  assert(summary.items[0]?.linkedCases.map((item) => item.id).join(',') === 'linked', '只允许显式来源关系')
}

export function testSummaryExcludesDeletedRootsAndCases(): void {
  const deletedRoot = trade({ id: 'deleted-root', deletedAt: '' })
  const root = trade({ id: 'root' })
  const deletedCase = trade({ id: 'deleted-case', tradeKind: 'case', sourceTradeId: root.id, deletedAt: '' })
  assert(isMissedOpportunityDeleted(deletedRoot), '空字符串 deletedAt 也必须视为软删除')
  const summary = buildMissedOpportunitySummary([deletedRoot, root, deletedCase], ['trade'])
  assert(summary.items.length === 1 && summary.items[0]?.linkedCases.length === 0, '软删除记录不得进入聚合')
}

export function testSummarySortsByOccurrenceThenStableKey(): void {
  const summary = buildMissedOpportunitySummary([
    trade({ id: 'b-live', closedAt: '2026-07-21T08:00:00.000Z' }),
    trade({ id: 'a-paper', tradeKind: 'paper', closedAt: '2026-07-21T08:00:00.000Z' }),
  ])
  assert(summary.items.map((item) => item.key).join(',') === 'a-paper,b-live', '同时间必须按英文 key 稳定排序')
}
