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
  const hasImportedPair = resultSource === 'imported' && pnlOutcome !== null && rOutcome !== null
  const metricConflict = hasImportedPair && pnlOutcome !== rOutcome
  const resolvedMetric = resultSource === 'pnl'
    ? pnlOutcome
    : resultSource === 'r' || resultSource === 'price'
      ? rOutcome
      : hasImportedPair && !metricConflict
        ? pnlOutcome
        : null
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

  const removedPlaceholder = pnl !== trade.pnl || rMultiple !== trade.rMultiple

  return {
    ...trade,
    pnl,
    rMultiple,
    resultSource: resolveTradeResultSource({
      ...trade,
      pnl,
      rMultiple,
      resultSource: removedPlaceholder ? undefined : trade.resultSource,
    }),
  }
}

/** 同一条已解析结果可同时计入总计和分组，避免反复解析及创建中间数组。 */
export class TradeResultAccumulator {
  private closedCount = 0
  private evaluatedCount = 0
  private winCount = 0
  private lossCount = 0
  private breakevenCount = 0
  private conflictCount = 0
  private pnlCount = 0
  private rCount = 0
  private totalPnl = 0
  private totalR = 0

  add(trade: Trade, truth: TradeTruth): void {
    if (!isExecutedClosed(trade.status)) return
    this.closedCount += 1
    if (truth.hasConflict) this.conflictCount += 1
    if (!truth.isResultComplete) return
    this.evaluatedCount += 1
    if (truth.outcome === 'win') this.winCount += 1
    else if (truth.outcome === 'loss') this.lossCount += 1
    else if (truth.outcome === 'breakeven') this.breakevenCount += 1
    const pnl = finiteMetric(trade.pnl)
    if (pnl !== null) {
      this.pnlCount += 1
      this.totalPnl += pnl
    }
    const r = finiteMetric(trade.rMultiple)
    if (r !== null) {
      this.rCount += 1
      this.totalR += r
    }
  }

  summarize(): TradeResultSummary {
    return {
      closedCount: this.closedCount,
      evaluatedCount: this.evaluatedCount,
      winCount: this.winCount,
      lossCount: this.lossCount,
      breakevenCount: this.breakevenCount,
      conflictCount: this.conflictCount,
      winRate: this.evaluatedCount ? (this.winCount / this.evaluatedCount) * 100 : null,
      pnlCount: this.pnlCount,
      rCount: this.rCount,
      totalPnl: this.totalPnl,
      averageR: this.rCount ? this.totalR / this.rCount : null,
    }
  }
}

export function summarizeTradeResults(trades: Trade[]): TradeResultSummary {
  const accumulator = new TradeResultAccumulator()
  for (const trade of trades) {
    if (isExecutedClosed(trade.status)) accumulator.add(trade, resolveTradeTruth(trade))
  }
  return accumulator.summarize()
}
