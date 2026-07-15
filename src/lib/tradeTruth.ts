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
  resultQuality: TradeResultValidation['quality']
  issues: TradeResultIssue[]
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

export type TradeResultIssueCode =
  | 'missing-result'
  | 'invalid-result-number'
  | 'status-result-conflict'
  | 'pnl-r-sign-conflict'
  | 'pnl-r-value-conflict'
  | 'invalid-risk-evidence'
  | 'risk-relationship-conflict'
  | 'invalid-cost-evidence'
  | 'gross-net-value-conflict'

export interface TradeResultIssue {
  code: TradeResultIssueCode
  severity: 'warning' | 'blocking'
  message: string
}

export interface TradeResultValidation {
  quality: 'missing' | 'confirmed' | 'verified' | 'conflict'
  issues: TradeResultIssue[]
  evidence: {
    pnl: number | null
    rMultiple: number | null
    initialRiskAmount: number | null
    calculatedR: number | null
    expectedNetPnl: number | null
    pnlBasis: 'unknown' | 'net'
    crossChecked: boolean
  }
  hasBlockingIssue: boolean
}

const R_ABSOLUTE_TOLERANCE = 0.01
const R_RELATIVE_TOLERANCE = 0.01
const MONEY_ABSOLUTE_TOLERANCE = 0.01
const MONEY_RELATIVE_TOLERANCE = 0.0001

function approximatelyEqual(
  actual: number,
  expected: number,
  absoluteTolerance: number,
  relativeTolerance: number,
): boolean {
  return Math.abs(actual - expected) <= Math.max(
    absoluteTolerance,
    Math.abs(expected) * relativeTolerance,
  )
}

function resultSign(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function resolveRiskEvidence(trade: Trade, issues: TradeResultIssue[]): number | null {
  const rawValues = [trade.initialRiskAmount, trade.initialRiskPct, trade.accountEquityAtEntry]
  const amount = finiteMetric(trade.initialRiskAmount)
  const pct = finiteMetric(trade.initialRiskPct)
  const equity = finiteMetric(trade.accountEquityAtEntry)
  const malformed = rawValues.some(
    (value) => value !== undefined && value !== null &&
      (typeof value !== 'number' || !Number.isFinite(value) || value <= 0),
  )
  if (malformed) {
    issues.push({
      code: 'invalid-risk-evidence',
      severity: 'blocking',
      message: '初始风险、账户权益和风险比例必须为正数。',
    })
    return null
  }

  const calculated = pct !== null && equity !== null ? equity * (pct / 100) : null
  if (
    amount !== null &&
    calculated !== null &&
    !approximatelyEqual(amount, calculated, MONEY_ABSOLUTE_TOLERANCE, MONEY_RELATIVE_TOLERANCE)
  ) {
    issues.push({
      code: 'risk-relationship-conflict',
      severity: 'blocking',
      message: '初始风险金额与账户权益、风险比例不一致。',
    })
  }
  return amount ?? calculated
}

function resolveExpectedNetPnl(trade: Trade, issues: TradeResultIssue[]): number | null {
  const gross = finiteMetric(trade.grossPnl)
  if (trade.costs === undefined) return null
  const values = [
    trade.costs.commission,
    trade.costs.exchange,
    trade.costs.financing,
    trade.costs.tax,
    trade.costs.other,
  ]
  const invalid = values.some(
    (value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0),
  )
  const incompleteCompleteCosts = trade.costs.completeness === 'complete' &&
    values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  if (invalid || incompleteCompleteCosts) {
    issues.push({
      code: 'invalid-cost-evidence',
      severity: 'blocking',
      message: '费用必须是非负有限数字；完整费用需要明确填写所有项目。',
    })
    return null
  }
  if (gross === null || trade.costs.completeness !== 'complete') return null
  return gross - values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
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

/**
 * 解释一笔结果的证据质量。未知口径的历史金额只校验方向；只有明确净额时才校验 R 数值。
 */
export function validateTradeResultEvidence(trade: Trade): TradeResultValidation {
  const issues: TradeResultIssue[] = []
  if (
    (trade.pnl !== null && finiteMetric(trade.pnl) === null) ||
    (trade.rMultiple !== null && finiteMetric(trade.rMultiple) === null) ||
    (trade.grossPnl !== undefined && trade.grossPnl !== null && finiteMetric(trade.grossPnl) === null)
  ) {
    issues.push({
      code: 'invalid-result-number',
      severity: 'blocking',
      message: '盈亏金额与 R 倍数必须是有限数字。',
    })
  }
  const pnl = finiteMetric(trade.pnl)
  const rMultiple = finiteMetric(trade.rMultiple)
  const source = resolveTradeResultSource(trade)
  const pairIsAuthoritative = source === 'imported' && pnl !== null && rMultiple !== null
  const pnlBasis = trade.pnlBasis === 'net' ? 'net' : 'unknown'
  const risk = resolveRiskEvidence(trade, issues)
  const expectedNetPnl = resolveExpectedNetPnl(trade, issues)
  let calculatedR: number | null = null
  let crossChecked = false

  if (pairIsAuthoritative && resultSign(pnl) !== resultSign(rMultiple)) {
    issues.push({
      code: 'pnl-r-sign-conflict',
      severity: 'blocking',
      message: '盈亏金额与 R 倍数方向不一致。',
    })
  } else if (pairIsAuthoritative && pnlBasis === 'net' && risk !== null) {
    calculatedR = pnl / risk
    if (!approximatelyEqual(rMultiple, calculatedR, R_ABSOLUTE_TOLERANCE, R_RELATIVE_TOLERANCE)) {
      issues.push({
        code: 'pnl-r-value-conflict',
        severity: 'blocking',
        message: `按初始风险应为 ${Number(calculatedR.toFixed(2))}R。`,
      })
    } else {
      crossChecked = true
    }
  }

  if (pnlBasis === 'net' && pnl !== null && expectedNetPnl !== null) {
    if (!approximatelyEqual(pnl, expectedNetPnl, MONEY_ABSOLUTE_TOLERANCE, MONEY_RELATIVE_TOLERANCE)) {
      issues.push({
        code: 'gross-net-value-conflict',
        severity: 'blocking',
        message: '净盈亏与毛盈亏减去完整费用后的结果不一致。',
      })
    } else {
      crossChecked = true
    }
  }

  const authoritativeMetric = source === 'pnl'
    ? pnl
    : source === 'r' || source === 'price'
      ? rMultiple
      : pairIsAuthoritative
        ? pnl
        : null
  const declared = declaredOutcome(trade.status)
  const metric = metricOutcome(authoritativeMetric)
  if (declared && metric && declared !== metric) {
    issues.push({
      code: 'status-result-conflict',
      severity: 'blocking',
      message: '交易状态与已确认的结果方向不一致。',
    })
  }
  if (executionStateFor(trade.status) === 'closed' && authoritativeMetric === null) {
    issues.push({
      code: 'missing-result',
      severity: 'warning',
      message: '已平仓交易尚未记录可判断结果的金额或 R。',
    })
  }

  const hasBlockingIssue = issues.some((issue) => issue.severity === 'blocking')
  return {
    quality: hasBlockingIssue
      ? 'conflict'
      : authoritativeMetric === null
        ? 'missing'
        : crossChecked
          ? 'verified'
          : 'confirmed',
    issues,
    evidence: {
      pnl,
      rMultiple,
      initialRiskAmount: risk,
      calculatedR,
      expectedNetPnl,
      pnlBasis,
      crossChecked,
    },
    hasBlockingIssue,
  }
}

export function resolveTradeTruth(trade: Trade): TradeTruth {
  const validation = validateTradeResultEvidence(trade)
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
  const hasConflict = metricConflict || declaredConflict || validation.hasBlockingIssue
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
    resultQuality: validation.quality,
    issues: validation.issues,
  }
}

function finiteMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 仅允许结果完整且不存在口径冲突的记录进入绩效聚合。 */
export function isUsableTradeResult(trade: Trade): boolean {
  return resolveTradeTruth(trade).isResultComplete
}

/** @deprecated 旧名称会把 confirmed 误解为 verified；新代码请使用 isUsableTradeResult。 */
export function isVerifiedTradeResult(trade: Trade): boolean {
  return isUsableTradeResult(trade)
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

/**
 * v7 持久化要求把“未知”也明确保存；这里只补证据元数据，不改变交易结果本身。
 */
export function normalizeTradeEvidenceDefaults(trade: Trade): Trade {
  const hasPnl = finiteMetric(trade.pnl) !== null
  const currency = hasPnl ? trade.pnlCurrency ?? 'USD' : null
  const currencySource = currency === null
    ? null
    : trade.pnlCurrencySource ?? 'inferred'
  return {
    ...trade,
    pnlBasis: trade.pnlBasis ?? 'unknown',
    pnlCurrency: currency,
    pnlCurrencySource: currencySource,
    openedAtTimestamp: trade.openedAtTimestamp ?? null,
    closedAtTimestamp: trade.closedAtTimestamp ?? null,
    pnlSource: trade.pnlSource ?? null,
    rSource: trade.rSource ?? null,
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
