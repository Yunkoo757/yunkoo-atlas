import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { isVerifiedTradeResult, summarizeTradeResults } from '@/lib/tradeTruth'

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

export function buildDashboardStats(closed: Trade[], strategyDefs: Strategy[]) {
  const summary = summarizeTradeResults(closed)
  const missingResultCount = Math.max(
    0,
    summary.closedCount - summary.evaluatedCount - summary.conflictCount,
  )
  const verified = closed.filter(isVerifiedTradeResult)
  const pnlTrades = verified.filter(
    (trade): trade is Trade & { pnl: number } =>
      typeof trade.pnl === 'number' && Number.isFinite(trade.pnl),
  )
  const rTrades = verified.filter(
    (trade): trade is Trade & { rMultiple: number } =>
      typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple),
  )

  const sorted = [...pnlTrades].sort(
    (left, right) =>
      +new Date(left.closedAt ?? left.openedAt) - +new Date(right.closedAt ?? right.openedAt),
  )
  let cumulative = 0
  const fullCurve: DashboardCurvePoint[] = sorted.map((trade) => {
    cumulative += trade.pnl
    const closedOn = (trade.closedAt ?? trade.openedAt).slice(0, 10)
    return {
      date: closedOn.slice(5),
      equity: cumulative,
      label: trade.symbol,
      tradeId: trade.id,
      ref: trade.ref,
      pnl: trade.pnl,
    }
  })

  const byStrategy = new Map<string, Trade[]>()
  for (const trade of closed) {
    const strategyTrades = byStrategy.get(trade.strategyId)
    if (strategyTrades) strategyTrades.push(trade)
    else byStrategy.set(trade.strategyId, [trade])
  }
  const strategyById = new Map(strategyDefs.map((strategy) => [strategy.id, strategy]))
  const strategies = [...byStrategy.entries()]
    .map(([id, strategyTrades]) => {
      const result = summarizeTradeResults(strategyTrades)
      const meta = strategyById.get(id)
      return {
        id,
        pnl: result.totalPnl,
        pnlCount: result.pnlCount,
        n: result.evaluatedCount,
        closedCount: result.closedCount,
        wins: result.winCount,
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
  const maxAbs = Math.max(
    1,
    ...strategies
      .filter((strategy) => strategy.pnlCount > 0)
      .map((strategy) => Math.abs(strategy.pnl)),
  )

  return {
    ...summary,
    missingResultCount,
    curve: downsampleDashboardCurve(fullCurve),
    strategies,
    maxAbs,
    rDist: buildRDistribution(rTrades.map((trade) => trade.rMultiple)),
  }
}
