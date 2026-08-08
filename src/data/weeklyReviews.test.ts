import type { Trade } from '@/data/trades'
import type { LivePerformanceCycleBounds } from '@/lib/livePerformanceCycles'
import {
  buildWeeklyReviewMetrics,
  createWeeklyReview,
  deriveWeeklyReviewWeeks,
  missedTradesInWeek,
  normalizeWeeklyReviews,
  tradesClosedInWeek,
  weekStartFor,
} from '@/data/weeklyReviews'
import { formatYmd, parseLocalDate } from '@/lib/periods'

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

function addDays(ymd: string, days: number): string {
  const date = parseLocalDate(ymd)
  date.setDate(date.getDate() + days)
  return formatYmd(date)
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
    trade({ id: 'missed', status: 'missed', missReason: 'hesitation', pnl: null, resultSource: undefined }),
  ]
  const result = tradesClosedInWeek(trades, '2026-07-13')
  assert(result.map((item) => item.id).join(',') === 'inside', '周事实不得混入模拟、未平仓、错过、已删除或其他周记录')
}

export function testWeeklyReviewFactsIgnoreRiskAccountingStart(): void {
  const trades = [
    trade({ id: 'old', openedAt: '2026-07-20', closedAt: '2026-07-28' }),
    trade({ id: 'new', openedAt: '2026-07-27', closedAt: '2026-07-28' }),
  ]
  const result = tradesClosedInWeek(trades, '2026-07-27', 0)
  assert(result.map((item) => item.id).join() === 'old,new', '风险核算起点不得截断当周交易事实')
}

export function testWeeklyReviewSeparatesMissedOpportunitiesByMarkedWeek(): void {
  const trades = [
    trade({ id: 'missed', status: 'missed', missReason: 'hesitation', pnl: null, resultSource: undefined }),
    trade({ id: 'executed' }),
    trade({ id: 'paper-missed', status: 'missed', tradeKind: 'paper', pnl: null, resultSource: undefined }),
    trade({ id: 'next-week-missed', status: 'missed', closedAt: '2026-07-20T01:00:00.000Z', pnl: null, resultSource: undefined }),
    trade({ id: 'deleted-missed', status: 'missed', deletedAt: '2026-07-17T00:00:00.000Z', pnl: null, resultSource: undefined }),
  ]
  const result = missedTradesInWeek(trades, '2026-07-13')
  assert(result.map((item) => item.id).join(',') === 'missed', '执行缺口只能包含本周标记的实盘错过机会')
}

export function testMissedTradesInWeekIntersectsPerformanceBounds(): void {
  const result = missedTradesInWeek([
    trade({ id: 'archive-missed', status: 'missed', closedAt: '2026-07-13', closedTradingDayKey: '2026-07-13', pnl: null, resultSource: undefined }),
    trade({ id: 'current-missed', status: 'missed', closedAt: '2026-07-14', closedTradingDayKey: '2026-07-14', pnl: null, resultSource: undefined }),
  ], '2026-07-13', 0, {
    startInclusive: '2026-07-14',
    endExclusive: '2026-07-21',
  } satisfies LivePerformanceCycleBounds)

  assert(result.map((item) => item.id).join(',') === 'current-missed', '本周错过机会必须与当前实盘表现边界取交集')
}

export function testWeeklyReviewWeeksKeepStoredWeeksAndLimitActivityHistory(): void {
  const activity = Array.from({ length: 14 }, (_, index) => trade({
    id: `activity-${index}`,
    closedAt: addDays('2026-07-27', -index * 7),
  }))
  const stored = createWeeklyReview('2025-01-06')

  const result = deriveWeeklyReviewWeeks(activity, [stored], '2026-08-03', 0, 12)

  assert(result.includes('2025-01-06'), '已有复盘不得被活动周上限淘汰')
  assert(result.includes('2026-08-03'), '当前周必须始终存在')
  const includedActivityWeeks = activity
    .map((item) => weekStartFor(parseLocalDate(item.closedAt!)))
    .filter((week) => result.includes(week))
  assert(new Set(includedActivityWeeks).size === 12, '只应补入最近 12 个活动周')
  assert(result.join() === [...result].sort((left, right) => right.localeCompare(left)).join(), '周列表必须按新到旧排序')
}

export function testWeeklyReviewWeeksOnlyIncludeReviewableLiveActivity(): void {
  const result = deriveWeeklyReviewWeeks([
    trade({ id: 'closed-live', closedAt: '2026-07-27' }),
    trade({ id: 'missed-live', status: 'missed', pnl: null, resultSource: undefined, closedAt: '2026-07-20' }),
    trade({ id: 'paper', tradeKind: 'paper', closedAt: '2026-07-13' }),
    trade({ id: 'case', tradeKind: 'case', closedAt: '2026-07-06' }),
    trade({ id: 'open', status: 'open', pnl: null, resultSource: undefined, closedAt: null }),
    trade({ id: 'deleted', deletedAt: '2026-06-29', closedAt: '2026-06-29' }),
  ], [], '2026-08-03')

  assert(result.join() === '2026-08-03,2026-07-27,2026-07-20', '空周和不可复盘记录不得进入列表')
}

export function testWeeklyReviewWeeksUseConfiguredTradingDayBoundary(): void {
  const earlyMonday = new Date(2026, 6, 27, 5, 0).toISOString()

  const result = deriveWeeklyReviewWeeks([
    trade({ id: 'boundary', closedAt: earlyMonday, closedTradingDayKey: undefined }),
  ], [], '2026-07-27', 6)

  assert(result.join() === '2026-07-27,2026-07-20', '周列表必须按配置后的交易日归属跨周记录')
}

export function testWeeklyReviewMetricsPreserveCoverageAndMistakeEvidence(): void {
  const metrics = buildWeeklyReviewMetrics([
    trade({ id: 'win', reviewStatus: 'reviewed', mistakeTags: ['追价'] }),
    trade({ id: 'focus', reviewStatus: 'focus' }),
    trade({ id: 'loss', status: 'loss', pnl: -50, mistakeTags: ['追价', '过早入场'] }),
  ], [
    trade({ id: 'missed-hesitation', status: 'missed', missReason: 'hesitation', mistakeTags: ['情绪化'], pnl: null, resultSource: undefined }),
    trade({ id: 'missed-alert', status: 'missed', missReason: 'no_alert', pnl: null, resultSource: undefined }),
  ])
  assert(metrics.tradeCount === 3 && metrics.reviewedCount === 2, '重点关注也已完成过复盘，应计入周复盘覆盖率')
  assert(Math.round(metrics.winRate ?? 0) === 67 && metrics.totalPnl === 150, '周指标必须复用可信结果口径')
  assert(metrics.mistakeTagCounts['追价'] === 2, '周指标应累计交易中的错误证据')
  assert(metrics.mistakeTagCounts['情绪化'] === undefined, '错过机会的标签不得污染已执行交易错误统计')
  assert(metrics.missedCount === 2, '错过机会应作为独立执行缺口统计')
  assert(metrics.missedReasonCounts.hesitation === 1 && metrics.missedReasonCounts.no_alert === 1, '执行缺口应保留原因分布')
}

export function testWeeklyReviewNormalizationKeepsTheLatestRecordForOneWeek(): void {
  const older = createWeeklyReview('2026-07-13', new Date('2026-07-13T00:00:00.000Z'))
  const newer = { ...older, id: 'newer', commitmentText: '等待确认', updatedAt: '2026-07-18T00:00:00.000Z' }
  const result = normalizeWeeklyReviews([older, newer])
  assert(result.length === 1 && result[0]?.id === 'newer', '同一周只能保留更新时间最新的一篇复盘')
}

export function testWeeklyReviewNormalizationKeepsFirstRecordWhenTimestampsTie(): void {
  const local = createWeeklyReview('2026-07-13', new Date('2026-07-13T00:00:00.000Z'))
  const imported = { ...local, id: 'imported', commitmentText: '导入内容' }

  const result = normalizeWeeklyReviews([local, imported])

  assert(result.length === 1 && result[0]?.id === local.id, '更新时间相同时必须保留先传入的本地复盘')
}

export function testWeeklyReviewNormalizationBackfillsLegacyMissedMetrics(): void {
  const review = createWeeklyReview('2026-07-13')
  const legacyMetrics = buildWeeklyReviewMetrics([trade({ id: 'win' })]) as Partial<ReturnType<typeof buildWeeklyReviewMetrics>>
  delete legacyMetrics.missedCount
  delete legacyMetrics.missedReasonCounts
  const result = normalizeWeeklyReviews([{
    ...review,
    metricsSnapshot: legacyMetrics as ReturnType<typeof buildWeeklyReviewMetrics>,
  }])
  assert(result[0]?.metricsSnapshot?.missedCount === 0, '旧周复盘快照应补齐错过机会数量')
  assert(Object.keys(result[0]?.metricsSnapshot?.missedReasonCounts ?? {}).length === 0, '旧周复盘快照应补齐空的错过原因分布')
}
