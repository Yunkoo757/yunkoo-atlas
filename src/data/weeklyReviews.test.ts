import type { Trade } from '@/data/trades'
import type { LivePerformanceCycleBounds } from '@/lib/livePerformanceCycles'
import {
  buildWeeklyReviewMetrics,
  buildWeeklyReviewTradeSelection,
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

export function testWeeklyReviewWeeksAndTradesRejectFactsAfterTheFrozenBusinessDay(): void {
  const current = trade({ id: 'current', closedAt: '2026-08-09', closedTradingDayKey: '2026-08-09' })
  const future = trade({ id: 'FX-CLOSE-FUTURE', closedAt: '2026-08-10', closedTradingDayKey: '2026-08-10' })
  const weeks = deriveWeeklyReviewWeeks(
    [current, future],
    [],
    '2026-08-03',
    0,
    12,
    '2026-08-09',
  )
  const closed = tradesClosedInWeek([current, future], '2026-08-03', 0, '2026-08-09')

  assert(weeks.join() === '2026-08-03', '未来平仓事实不得创建未来周入口')
  assert(closed.map((item) => item.id).join() === 'current', '实时周指标与证据必须冻结在当前业务日')
}

export function testWeeklyReviewEvidenceKeepsReliableConflictAndPendingResultsWithoutMetrics(): void {
  const eligible = trade({
    id: 'eligible',
    closedAt: '2026-08-04',
    closedTradingDayKey: '2026-08-04',
    cashCurrency: 'USD',
  })
  const conflict = trade({
    id: 'conflict',
    status: 'win',
    closedAt: '2026-08-05',
    closedTradingDayKey: '2026-08-05',
    pnl: -500,
    rMultiple: 1,
    resultSource: 'imported',
  })
  const pending = trade({
    id: 'pending',
    status: 'win',
    closedAt: '2026-08-06',
    closedTradingDayKey: '2026-08-06',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  })
  const future = trade({
    id: 'future',
    closedAt: '2026-08-10',
    closedTradingDayKey: '2026-08-10',
  })

  const selection = buildWeeklyReviewTradeSelection(
    [eligible, conflict, pending, future],
    '2026-08-03',
    0,
    '2026-08-09',
    null,
  )
  const metrics = buildWeeklyReviewMetrics(
    selection.trades,
    [],
    selection.pnlIds,
    selection,
  )
  const conflictOnlyWeeks = deriveWeeklyReviewWeeks([conflict], [], '2026-08-10', 0, 12, '2026-08-10')
  const pendingOnlyWeeks = deriveWeeklyReviewWeeks([pending], [], '2026-08-10', 0, 12, '2026-08-10')

  assert(selection.trades.map((item) => item.id).join() === 'eligible,conflict,pending', '周事实必须保留可靠日期的完整、冲突和待补结果，future 必须排除')
  assert(selection.eligibleMetricIds.join() === 'eligible', '只有完整结果可以成为绩效样本')
  assert(selection.conflictResultIds.join() === 'conflict' && selection.missingResultIds.join() === 'pending', '周选择必须保留冲突与待补结果分类')
  assert(metrics.tradeCount === 1 && metrics.pnlCount === 1 && metrics.totalPnl === 100, '冲突和待补结果不得进入平仓数或 USD 绩效')
  assert(metrics.rCount === 0 && metrics.winRate === 100, '冲突和待补结果不得进入 R 或胜率')
  assert(metrics.conflictCount === 1 && metrics.pendingResultCount === 1, '周指标必须暴露独立 conflict/pending 告警计数')
  assert(conflictOnlyWeeks.includes('2026-08-03'), '仅有冲突结果的周也必须生成周入口')
  assert(pendingOnlyWeeks.includes('2026-08-03'), '仅有待补结果的周也必须生成周入口')
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
