import type { Trade, TradeResultSource, TradeStatus } from '@/data/trades'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { calcPriceResult, calcRFromFrozenPriceRisk } from '@/lib/tradeCalc'

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
  const resultSource = resolveTradeResultSource(trade)
  const metricOutcomes = (
    resultSource === 'pnl'
      ? [pnlOutcome]
      : resultSource === 'r' || resultSource === 'price'
        ? [rOutcome]
        : resultSource === 'imported' && pnlOutcome !== null && rOutcome !== null
          ? [pnlOutcome, rOutcome]
          : []
  ).filter(
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

/** 仅允许结果完整且不存在口径冲突的记录进入绩效聚合。 */
export function isVerifiedTradeResult(trade: Trade): boolean {
  return resolveTradeTruth(trade).isResultComplete
}

const RESULT_SOURCES = new Set<TradeResultSource>(['pnl', 'r', 'price', 'imported'])

export function isTradeResultAuthorityConsistent(trade: {
  pnl?: unknown
  rMultiple?: unknown
  resultSource?: unknown
  side?: unknown
  entry?: unknown
  exit?: unknown
  stopLoss?: unknown
  initialStopLoss?: unknown
}): boolean {
  if (trade.resultSource === undefined) return true
  if (!RESULT_SOURCES.has(trade.resultSource as TradeResultSource)) return false
  const hasPnl = finiteMetric(trade.pnl) !== null
  const hasR = finiteMetric(trade.rMultiple) !== null
  switch (trade.resultSource) {
    case 'pnl':
      return hasPnl && !hasR
    case 'r':
      return !hasPnl && hasR
    case 'price': {
      if (hasPnl || !hasR || (trade.side !== 'long' && trade.side !== 'short')) return false
      const entry = finiteMetric(trade.entry)
      const exit = finiteMetric(trade.exit)
      const initialRisk = finiteMetric(trade.initialStopLoss) ?? finiteMetric(trade.stopLoss)
      if (entry === null || exit === null || initialRisk === null) return false
      const calculated = calcRFromFrozenPriceRisk(
        entry,
        calcPriceResult(trade.side, entry, exit),
        initialRisk,
      )
      const stored = finiteMetric(trade.rMultiple)
      return calculated !== null && stored !== null && Math.abs(calculated - stored) < 1e-6
    }
    case 'imported':
      return hasPnl && hasR
    default:
      return false
  }
}

export function resolveTradeResultSource(
  trade: Pick<Trade, 'pnl' | 'rMultiple' | 'resultSource'>,
): TradeResultSource | undefined {
  if (trade.resultSource !== undefined) {
    return RESULT_SOURCES.has(trade.resultSource) ? trade.resultSource : undefined
  }
  const hasPnl = finiteMetric(trade.pnl) !== null
  const hasR = finiteMetric(trade.rMultiple) !== null
  if (hasPnl && hasR) return 'imported'
  if (hasPnl) return 'pnl'
  if (hasR) return 'r'
  return undefined
}

/** 把历史占位 0 迁移为缺失值，同时保留明确的保本结果。 */
export function normalizeTradeMetrics(trade: Trade): Trade {
  let pnl = finiteMetric(trade.pnl)
  let rMultiple = finiteMetric(trade.rMultiple)

  if (trade.status !== 'breakeven') {
    if (pnl === 0) pnl = null
    if (rMultiple === 0) rMultiple = null
  }

  return {
    ...trade,
    pnl,
    rMultiple,
    resultSource: resolveTradeResultSource({ ...trade, pnl, rMultiple }),
  }
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
  const verifiedClosed = closed.filter((_, index) => truths[index]?.isResultComplete)
  const pnlValues = verifiedClosed
    .map((trade) => finiteMetric(trade.pnl))
    .filter((value): value is number => value !== null)
  const rValues = verifiedClosed
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
