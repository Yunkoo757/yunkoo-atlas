import {
  MAX_DASHBOARD_CURVE_POINTS,
  buildRDistribution,
  downsampleDashboardCurve,
  type DashboardCurvePoint,
} from './dashboardStats'

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
