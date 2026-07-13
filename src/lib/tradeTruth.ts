import type { Trade, TradeStatus } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'

export type ExecutionState = 'planned' | 'open' | 'closed' | 'missed'
export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'unknown' | 'conflict'

export interface TradeTruth {
  executionState: ExecutionState
  outcome: TradeOutcome
  hasPnl: boolean
  hasR: boolean
  isResultComplete: boolean
  hasConflict: boolean
}

export interface TradeResultSummary {
  closedCount: number
  evaluatedCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  conflictCount: number
  winRate: number | null
  pnlCount: number
  rCount: number
  totalPnl: number
  averageR: number | null
}

function executionStateFor(status: TradeStatus): ExecutionState {
  if (status === 'planned' || status === 'open' || status === 'missed') return status
  return 'closed'
}

function metricOutcome(value: unknown): Exclude<TradeOutcome, 'unknown' | 'conflict'> | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value > 0) return 'win'
  if (value < 0) return 'loss'
  return 'breakeven'
}

function declaredOutcome(status: TradeStatus): Exclude<TradeOutcome, 'unknown' | 'conflict'> | null {
  if (status === 'win' || status === 'loss' || status === 'breakeven') return status
  return null
}

export function resolveTradeTruth(trade: Trade): TradeTruth {
  const executionState = executionStateFor(trade.status)
  const pnlOutcome = metricOutcome(trade.pnl)
  const rOutcome = metricOutcome(trade.rMultiple)
  const declared = declaredOutcome(trade.status)
  const metricOutcomes = [pnlOutcome, rOutcome].filter(
    (value): value is Exclude<TradeOutcome, 'unknown' | 'conflict'> => value !== null,
  )
  const metricConflict = new Set(metricOutcomes).size > 1
  const resolvedMetric = metricConflict ? null : metricOutcomes[0] ?? null
  const declaredConflict = Boolean(declared && resolvedMetric && declared !== resolvedMetric)
  const hasConflict = metricConflict || declaredConflict
  const outcome: TradeOutcome =
    executionState !== 'closed'
      ? 'unknown'
      : hasConflict
        ? 'conflict'
        : resolvedMetric ?? 'unknown'

  return {
    executionState,
    outcome,
    hasPnl: pnlOutcome !== null,
    hasR: rOutcome !== null,
    isResultComplete: outcome === 'win' || outcome === 'loss' || outcome === 'breakeven',
    hasConflict,
  }
}

function finiteMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 把历史占位 0 迁移为缺失值，同时保留明确的保本结果。 */
export function normalizeTradeMetrics(trade: Trade): Trade {
  let pnl = finiteMetric(trade.pnl)
  let rMultiple = finiteMetric(trade.rMultiple)

  if (trade.status !== 'breakeven') {
    if (pnl === 0) pnl = null
    if (rMultiple === 0) rMultiple = null
  }

  return { ...trade, pnl, rMultiple }
}

export function summarizeTradeResults(trades: Trade[]): TradeResultSummary {
  const closed = trades.filter((trade) => isExecutedClosed(trade.status))
  const truths = closed.map(resolveTradeTruth)
  const evaluated = truths.filter(
    (truth) =>
      truth.outcome === 'win' ||
      truth.outcome === 'loss' ||
      truth.outcome === 'breakeven',
  )
  const pnlValues = closed
    .map((trade) => finiteMetric(trade.pnl))
    .filter((value): value is number => value !== null)
  const rValues = closed
    .map((trade) => finiteMetric(trade.rMultiple))
    .filter((value): value is number => value !== null)
  const winCount = evaluated.filter((truth) => truth.outcome === 'win').length

  return {
    closedCount: closed.length,
    evaluatedCount: evaluated.length,
    winCount,
    lossCount: evaluated.filter((truth) => truth.outcome === 'loss').length,
    breakevenCount: evaluated.filter((truth) => truth.outcome === 'breakeven').length,
    conflictCount: truths.filter((truth) => truth.hasConflict).length,
    winRate: evaluated.length ? (winCount / evaluated.length) * 100 : null,
    pnlCount: pnlValues.length,
    rCount: rValues.length,
    totalPnl: pnlValues.reduce((sum, value) => sum + value, 0),
    averageR: rValues.length
      ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
      : null,
  }
}
