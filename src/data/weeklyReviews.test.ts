import type { Trade } from '@/data/trades'
import {
  buildWeeklyReviewMetrics,
  createWeeklyReview,
  normalizeWeeklyReviews,
  tradesClosedInWeek,
  weekStartFor,
} from '@/data/weeklyReviews'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: 'trade-1',
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
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
    pnl: 100,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-13T09:00:00.000Z',
    closedAt: '2026-07-13T10:00:00.000Z',
    note: '',
    ...overrides,
  }
}

export function testWeeklyReviewUsesMondayAsTheLocalWeekBoundary(): void {
  assert(
    weekStartFor(new Date(2026, 6, 17, 22, 30)) === '2026-07-13',
    '周复盘必须按本地周一开始，不能受 UTC 日期偏移影响',
  )
}

export function testWeeklyReviewFactsOnlyIncludeLiveTradesClosedInsideTheWeek(): void {
  const trades = [
    trade({ id: 'inside' }),
    trade({ id: 'paper', tradeKind: 'paper' }),
    trade({ id: 'next-week', closedAt: '2026-07-20T01:00:00.000Z' }),
    trade({ id: 'deleted', deletedAt: '2026-07-17T00:00:00.000Z' }),
    trade({ id: 'open', status: 'open', closedAt: null, pnl: null, resultSource: undefined }),
  ]
  const result = tradesClosedInWeek(trades, '2026-07-13')
  assert(result.map((item) => item.id).join(',') === 'inside', '周事实不得混入模拟、未平仓、已删除或其他周记录')
}

export function testWeeklyReviewMetricsPreserveCoverageAndMistakeEvidence(): void {
  const metrics = buildWeeklyReviewMetrics([
    trade({ id: 'win', reviewStatus: 'reviewed', mistakeTags: ['追价'] }),
    trade({ id: 'loss', status: 'loss', pnl: -50, mistakeTags: ['追价', '过早入场'] }),
  ])
  assert(metrics.tradeCount === 2 && metrics.reviewedCount === 1, '周指标应保留交易与已复盘覆盖率')
  assert(metrics.winRate === 50 && metrics.totalPnl === 50, '周指标必须复用可信结果口径')
  assert(metrics.mistakeTagCounts['追价'] === 2, '周指标应累计交易中的错误证据')
}

export function testWeeklyReviewNormalizationKeepsTheLatestRecordForOneWeek(): void {
  const older = createWeeklyReview('2026-07-13', new Date('2026-07-13T00:00:00.000Z'))
  const newer = { ...older, id: 'newer', commitmentText: '等待确认', updatedAt: '2026-07-18T00:00:00.000Z' }
  const result = normalizeWeeklyReviews([older, newer])
  assert(result.length === 1 && result[0]?.id === 'newer', '同一周只能保留更新时间最新的一篇复盘')
}
