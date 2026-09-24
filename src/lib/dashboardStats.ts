import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { DEFAULT_TRADING_DAY_START_HOUR } from '@/lib/periods'
import { closedTradingDayKey } from '@/lib/riskBudget'
import { resolveTradeTruth, TradeResultAccumulator } from '@/lib/tradeTruth'

export const MAX_DASHBOARD_CURVE_POINTS = 600

export type DashboardCurvePoint = {
  date: string
  equity: number
  label: string
  tradeId: string
  ref: string
  pnl: number
}

export type DashboardRBucket = {
  label: string
  n: number
  lo: number
}

const R_BUCKET_RANGES = [
  { label: '<-3', min: Number.NEGATIVE_INFINITY, max: -3 },
  { label: '-3~-2', min: -3, max: -2 },
  { label: '-2~-1', min: -2, max: -1 },
  { label: '-1~-0.5', min: -1, max: -0.5 },
  { label: '-0.5~0', min: -0.5, max: 0 },
  { label: '0~0.5', min: 0, max: 0.5 },
  { label: '0.5~1', min: 0.5, max: 1 },
  { label: '1~2', min: 1, max: 2 },
  { label: '2~3', min: 2, max: 3 },
  { label: '3~5', min: 3, max: 5 },
  { label: '5~10', min: 5, max: 10 },
  { label: '≥10', min: 10, max: Number.POSITIVE_INFINITY },
] as const

export function downsampleDashboardCurve(
  points: DashboardCurvePoint[],
  maxPoints = MAX_DASHBOARD_CURVE_POINTS,
): DashboardCurvePoint[] {
  const limit = Math.max(3, Math.floor(maxPoints))
  if (points.length <= limit) return points

  const interiorLength = points.length - 2
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2))
  const sampled: DashboardCurvePoint[] = [points[0]]

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = 1 + Math.floor((bucketIndex * interiorLength) / bucketCount)
    const end = 1 + Math.floor(((bucketIndex + 1) * interiorLength) / bucketCount)
    if (start >= end) continue

    let minIndex = start
    let maxIndex = start
    for (let pointIndex = start + 1; pointIndex < end; pointIndex += 1) {
      if (points[pointIndex].equity < points[minIndex].equity) minIndex = pointIndex
      if (points[pointIndex].equity > points[maxIndex].equity) maxIndex = pointIndex
    }

    if (minIndex === maxIndex) {
      sampled.push(points[minIndex])
    } else if (minIndex < maxIndex) {
      sampled.push(points[minIndex], points[maxIndex])
    } else {
      sampled.push(points[maxIndex], points[minIndex])
    }
  }

  sampled.push(points.at(-1)!)
  return sampled
}

export function buildRDistribution(values: number[]): DashboardRBucket[] {
  const counts = Array.from({ length: R_BUCKET_RANGES.length }, () => 0)
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const bucketIndex = R_BUCKET_RANGES.findIndex(
      (range) => value >= range.min && value < range.max,
    )
    if (bucketIndex >= 0) counts[bucketIndex] += 1
  }
  return R_BUCKET_RANGES.map((range, index) => ({
    label: range.label,
    n: counts[index],
    lo: range.min,
  }))
}

export function describeDashboardResultHealth({
  conflictCount,
  missingResultCount,
}: {
  conflictCount: number
  missingResultCount: number
}): string {
  const issues = [
    conflictCount > 0 ? `${conflictCount} 笔结果冲突` : '',
    missingResultCount > 0 ? `${missingResultCount} 笔待补结果` : '',
  ].filter(Boolean)
  return issues.join(' · ') || '结果完整'
}

export function buildDashboardStats(
  closed: Trade[],
  strategyDefs: Strategy[],
  eligibleMetricIds?: readonly string[],
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  eligibleUsdPnlIds: readonly string[] = [],
) {
  let selected = closed
  if (eligibleMetricIds !== undefined) {
    const tradeById = new Map<string, Trade>()
    for (const trade of closed) tradeById.set(trade.id, trade)
    selected = []
    for (const id of eligibleMetricIds) {
      const trade = tradeById.get(id)
      if (trade) selected.push(trade)
    }
  }

  const accumulator = new TradeResultAccumulator()
  const eligibleUsdPnlIdSet = new Set(eligibleUsdPnlIds)
  const byStrategy = new Map<string, {
    tradeIds: string[]
    accumulator: TradeResultAccumulator
    pnl: number
    pnlCount: number
  }>()
  const pnlTradesByDay = new Map<string, Trade[]>()
  // 同一业务日/平仓时间只校验一次；缓存仅存活于本次计算，不会跨交易修改失效。
  const frozenDayCache = new Map<string, string | null>()
  const closedAtCache = new Map<string | null, string | null>()
  const rValues: number[] = []
  let totalPnl = 0
  let pnlCount = 0

  for (const trade of selected) {
    const truth = resolveTradeTruth(trade)
    accumulator.add(trade, truth)
    let group = byStrategy.get(trade.strategyId)
    if (!group) {
      group = { tradeIds: [], accumulator: new TradeResultAccumulator(), pnl: 0, pnlCount: 0 }
      byStrategy.set(trade.strategyId, group)
    }
    group.tradeIds.push(trade.id)
    group.accumulator.add(trade, truth)
    const eligiblePnl = typeof trade.pnl === 'number' && Number.isFinite(trade.pnl) &&
      eligibleUsdPnlIdSet.has(trade.id)
    if (eligiblePnl) {
      group.pnl += trade.pnl!
      group.pnlCount += 1
    }
    if (!truth.isResultComplete) continue
    if (typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple)) {
      rValues.push(trade.rMultiple)
    }
    if (!eligiblePnl) continue
    totalPnl += trade.pnl!
    pnlCount += 1
    let day: string | null | undefined
    if (trade.closedTradingDayKey !== undefined) {
      day = frozenDayCache.get(trade.closedTradingDayKey)
      if (day === undefined) {
        day = closedTradingDayKey(trade, tradingDayStartHour)
        frozenDayCache.set(trade.closedTradingDayKey, day)
      }
    } else {
      day = closedAtCache.get(trade.closedAt)
      if (day === undefined) {
        day = closedTradingDayKey(trade, tradingDayStartHour)
        closedAtCache.set(trade.closedAt, day)
      }
    }
    if (day !== null) {
      const dayTrades = pnlTradesByDay.get(day)
      if (dayTrades) dayTrades.push(trade)
      else pnlTradesByDay.set(day, [trade])
    }
  }

  const summary = accumulator.summarize()
  const missingResultCount = Math.max(
    0,
    summary.closedCount - summary.evaluatedCount - summary.conflictCount,
  )
  // 只排序不同业务日，同日按选择器顺序追加，等价于对所有交易执行稳定日期排序。
  let cumulative = 0
  const fullCurve: DashboardCurvePoint[] = []
  for (const day of [...pnlTradesByDay.keys()].sort()) {
    const date = day.slice(5)
    for (const trade of pnlTradesByDay.get(day)!) {
      cumulative += trade.pnl!
      fullCurve.push({
        date,
        equity: cumulative,
        label: trade.symbol,
        tradeId: trade.id,
        ref: trade.ref,
        pnl: trade.pnl!,
      })
    }
  }

  const strategyById = new Map(strategyDefs.map((strategy) => [strategy.id, strategy]))
  const strategies = [...byStrategy.entries()]
    .map(([id, group]) => {
      const result = group.accumulator.summarize()
      const meta = strategyById.get(id)
      return {
        id,
        tradeIds: group.tradeIds,
        pnl: group.pnl,
        pnlCount: group.pnlCount,
        n: result.evaluatedCount,
        closedCount: result.closedCount,
        wins: result.winCount,
        losses: result.lossCount,
        breakevens: result.breakevenCount,
        averageR: result.averageR,
        rCount: result.rCount,
        name: meta?.name ?? '未分类',
        meta,
        winRate: result.winRate,
      }
    })
    .sort((left, right) => {
      if (left.pnlCount === 0 && right.pnlCount > 0) return 1
      if (right.pnlCount === 0 && left.pnlCount > 0) return -1
      return right.pnl - left.pnl
    })
  let maxAbs = 1
  for (const strategy of strategies) {
    if (strategy.pnlCount > 0) maxAbs = Math.max(maxAbs, Math.abs(strategy.pnl))
  }

  return {
    ...summary,
    totalPnl,
    pnlCount,
    missingResultCount,
    curve: downsampleDashboardCurve(fullCurve),
    strategies,
    maxAbs,
    rDist: buildRDistribution(rValues),
  }
}
