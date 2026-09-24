import {
  MAX_DASHBOARD_CURVE_POINTS,
  buildDashboardStats,
  buildRDistribution,
  describeDashboardResultHealth,
  downsampleDashboardCurve,
  type DashboardCurvePoint,
} from './dashboardStats'
import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function curvePoint(index: number, equity = index): DashboardCurvePoint {
  return {
    date: `07-${String((index % 28) + 1).padStart(2, '0')}`,
    equity,
    label: `SYM-${index}`,
    tradeId: `trade-${index}`,
    ref: `TRD-${index}`,
    pnl: index === 0 ? equity : 1,
  }
}

export function testDashboardCurveSamplingCapsSvgWorkAndPreservesLocalExtremes(): void {
  const points = Array.from({ length: 10_000 }, (_, index) => curvePoint(index))
  points[3_333] = curvePoint(3_333, -12_000)
  points[7_777] = curvePoint(7_777, 18_000)

  const sampled = downsampleDashboardCurve(points)

  assert(sampled.length <= MAX_DASHBOARD_CURVE_POINTS, '累计曲线不得生成超过渲染预算的数据点')
  assert(sampled[0] === points[0], '降采样必须保留第一笔交易')
  assert(sampled.at(-1) === points.at(-1), '降采样必须保留最后一笔交易')
  assert(sampled.includes(points[3_333]), '降采样必须保留局部最低点')
  assert(sampled.includes(points[7_777]), '降采样必须保留局部最高点')
}

export function testDashboardCurveSamplingKeepsSmallSeriesUntouched(): void {
  const points = Array.from({ length: 20 }, (_, index) => curvePoint(index))
  assert(downsampleDashboardCurve(points) === points, '小数据集应复用原数组并保留每个可点击数据点')
}

export function testDashboardRDistributionCountsEveryFiniteValueExactlyOnce(): void {
  const values = [-4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5, 10, 11, Number.NaN]
  const distribution = buildRDistribution(values)
  const total = distribution.reduce((sum, bucket) => sum + bucket.n, 0)

  assert(total === values.length - 1, 'R 分布必须覆盖每一个有限 R 值且不得重复计数')
  assert(distribution[0]?.label === '<-3' && distribution[0].n === 1, '必须保留小于 -3R 的尾部风险')
  assert(distribution.at(-1)?.label === '≥10' && distribution.at(-1)?.n === 2, '10R 及以上必须进入最后一档')
  assert(distribution.find((bucket) => bucket.label === '-0.5~0')?.n === 1, '负值区间不得与 0R 重叠')
  assert(distribution.find((bucket) => bucket.label === '0~0.5')?.n === 1, '0R 只能计入非负区间一次')
}

const strategy: Strategy = {
  id: 'strategy-1',
  name: '测试策略',
  icon: 'target',
  color: '#5e6ad2',
}

function closedTrade(id: string, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: 2,
    resultSource: 'r',
    openedAt: '2026-07-01',
    closedAt: '2026-07-02',
    note: '',
    ...patch,
  }
}

export function testDashboardDoesNotTurnMissingPnlIntoZero(): void {
  const stats = buildDashboardStats([closedTrade('r-only')], [strategy])

  assert(stats.totalPnl === 0, '聚合的数值恒等元仍应为 0')
  assert(stats.pnlCount === 0, '只填写 R 的交易不得计入盈亏覆盖')
  assert(stats.strategies[0]?.pnlCount === 0, '策略行必须暴露真实盈亏覆盖')
  assert(stats.curve.length === 0, '缺少盈亏时不得绘制伪造的零收益曲线')
}

export function testDashboardHealthReportsConflictsAndMissingResultsTogether(): void {
  const conflict = closedTrade('conflict', {
    pnl: 10,
    rMultiple: -1,
    resultSource: 'imported',
  })
  const missing = closedTrade('missing', {
    status: 'loss',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  })
  const stats = buildDashboardStats([conflict, missing], [strategy])

  assert(stats.conflictCount === 1, '必须识别结果冲突')
  assert(stats.missingResultCount === 1, '冲突记录不得被重复计入待补结果')
  assert(
    describeDashboardResultHealth(stats) === '1 笔结果冲突 · 1 笔待补结果',
    '混合数据问题必须同时呈现，不能让冲突遮住缺失结果',
  )
}

export function testDashboardStatsUseOnlyEligibleMetricIdsForEveryAggregation(): void {
  const eligibleA = closedTrade('eligible-a', {
    pnl: 25,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2030-01-01',
    closedAt: '2026-08-09T05:59:59.000+08:00',
  })
  const eligibleB = closedTrade('eligible-b', {
    status: 'loss',
    pnl: -5,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2020-01-01',
    closedAt: '2026-08-09T06:00:00.000+08:00',
  })
  const excluded = closedTrade('excluded', {
    pnl: 10_000,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2010-01-01',
    closedAt: '2026-08-08',
  })

  const stats = buildDashboardStats(
    [excluded, eligibleB, eligibleA],
    [strategy],
    ['eligible-a', 'eligible-b'],
    6,
    ['eligible-a', 'eligible-b'],
  )

  assert(stats.totalPnl === 20, '总计必须只消费 eligibleMetricIds')
  assert(stats.curve.map((point) => point.tradeId).join() === 'eligible-a,eligible-b', '曲线成员必须与 eligibleMetricIds 一致')
  assert(stats.curve.map((point) => point.date).join() === '08-08,08-09', '曲线日期必须按 06:00 平仓业务日计算')
  assert(stats.strategies[0]?.tradeIds.join() === 'eligible-a,eligible-b', '策略分组成员必须与 eligibleMetricIds 一致')
}

export function testDashboardStatsOnlyAggregatesTheProvidedUsdPnlIds(): void {
  const usd = closedTrade('usd', { pnl: 100, cashCurrency: 'USD', resultSource: 'pnl' })
  const cny = closedTrade('cny', { pnl: 900, cashCurrency: 'CNY', resultSource: 'pnl' })
  const unknown = closedTrade('unknown', { pnl: 50, cashCurrency: null, resultSource: 'pnl' })
  const guardedBuilder = buildDashboardStats as unknown as (
    trades: Trade[],
    strategies: Strategy[],
    eligibleIds: readonly string[],
    tradingDayStartHour: number,
    usdPnlIds: readonly string[],
  ) => ReturnType<typeof buildDashboardStats>
  const stats = guardedBuilder(
    [usd, cny, unknown],
    [strategy],
    ['usd', 'cny', 'unknown'],
    6,
    ['usd'],
  )

  assert(stats.totalPnl === 100, 'USD 总计不得混入 CNY 或 unknown 金额')
  assert(stats.pnlCount === 1, 'USD 覆盖笔数必须只来自选择器 pnlIds')
  assert(stats.curve.map((point) => point.tradeId).join(',') === 'usd', '累计现金曲线必须与 USD pnlIds 同源')
  assert(stats.strategies[0]?.pnl === 100, '策略现金汇总不得绕过 USD guardrail')
}

export function testDashboardGroupedCurveMatchesStableOrderingAndSampling(): void {
  const trades = Array.from({ length: 2_507 }, (_, index) => {
    const pnl = (index % 7) - 3
    return closedTrade(`curve-${index}`, {
      status: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
      pnl,
      rMultiple: null,
      resultSource: 'pnl',
      closedTradingDayKey: `2026-07-${String((index * 17) % 28 + 1).padStart(2, '0')}`,
      closedAt: 'invalid-but-frozen-day-is-authoritative',
    })
  })
  const selectedIds = trades.map((trade) => trade.id).reverse()
  const stats = buildDashboardStats(trades, [strategy], selectedIds, 6, selectedIds)
  const sorted = [...trades].reverse().sort((left, right) =>
    left.closedTradingDayKey!.localeCompare(right.closedTradingDayKey!),
  )
  let equity = 0
  const expected = sorted.map((trade) => {
    equity += trade.pnl!
    return {
      date: trade.closedTradingDayKey!.slice(5),
      equity,
      label: trade.symbol,
      tradeId: trade.id,
      ref: trade.ref,
      pnl: trade.pnl!,
    }
  })
  assert(
    JSON.stringify(stats.curve) === JSON.stringify(downsampleDashboardCurve(expected)),
    '日期分桶必须保持原稳定排序、逐笔累计、小数舍入顺序和极值采样',
  )
  assert(trades[0].id === 'curve-0', '统计不得重排调用者的交易数组')
}

export function testDashboardSelectionPreservesDuplicateIdsAndLastDefinition(): void {
  const older = closedTrade('duplicate', { pnl: 5, rMultiple: null, resultSource: 'pnl' })
  const newer = closedTrade('duplicate', { pnl: 12.5, rMultiple: null, resultSource: 'pnl' })
  const stats = buildDashboardStats(
    [older, newer],
    [strategy, { ...strategy, name: '最新策略名' }],
    ['missing', 'duplicate', 'duplicate'],
    6,
    ['duplicate'],
  )
  assert(stats.closedCount === 2 && stats.totalPnl === 25, '选择顺序和重复成员必须保留，重复定义取最后一笔')
  assert(stats.strategies[0].name === '最新策略名', '重复策略定义必须保持最后一项优先')
  assert(stats.curve.map((point) => point.equity).join() === '12.5,25', '同日重复成员的累计曲线必须保留')
  const implicit = buildDashboardStats([older, newer], [strategy], undefined, 6, ['duplicate'])
  assert(implicit.totalPnl === 17.5, '未传选择器时仍应逐笔使用原数组，不按 ID 折叠')
}

export function testDashboardDateCacheKeepsFrozenAuthorityAndDoesNotSurviveEdits(): void {
  const make = (id: string, patch: Partial<Trade>) => closedTrade(id, {
    pnl: 1,
    rMultiple: null,
    resultSource: 'pnl',
    ...patch,
  })
  const trades = [
    make('frozen', { closedTradingDayKey: '2026-07-02', closedAt: null }),
    make('legacy', { closedAt: '2026-07-02' }),
    make('invalid-frozen', { closedTradingDayKey: '2026-02-30', closedAt: '2026-07-02' }),
    make('invalid-legacy', { closedAt: '2026-02-30' }),
  ]
  const ids = trades.map((trade) => trade.id)
  const first = buildDashboardStats(trades, [strategy], ids, 6, ids)
  assert(first.totalPnl === 4 && first.pnlCount === 4, '无合法日期的有效结果仍计入现金总计')
  assert(first.curve.map((point) => point.tradeId).join() === 'frozen,legacy', '非法冻结业务日不得回退平仓日；非法历史日期不得进入曲线')
  trades[0].closedTradingDayKey = '2026-07-03'
  trades[1].pnl = 2
  const second = buildDashboardStats(trades, [strategy], ids, 6, ids)
  assert(second.curve.map((point) => point.tradeId).join() === 'legacy,frozen', '修改日期后必须重新计算业务日顺序')
  assert(second.totalPnl === 5 && second.curve.at(-1)?.equity === 3, '本轮缓存不得遮住下次结果修改')
}
