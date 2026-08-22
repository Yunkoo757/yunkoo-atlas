import type {
  MonthlyRiskLimit,
  RiskCoverage,
  RiskDataIssue,
  RiskPeriodOutcomeSnapshot,
  RiskPartialReason,
  RiskPolicyVersion,
  RiskUnknownReason,
} from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { activeRiskPolicy } from '@/lib/activeRiskPolicy'
import { filterTradesForLiveCycle } from '@/lib/liveCycle'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { isExecutedClosed } from '@/lib/tradeStatus'
import {
  isTradeResultAuthorityConsistent,
  resolveTradeResultSource,
  resolveTradeTruth,
} from '@/lib/tradeTruth'
import { quantizeDecimal, scaledIntegerFromDecimalNumber, toMoneyCents } from '@/lib/money'

export { scaledIntegerFromDecimalNumber, toMoneyCents } from '@/lib/money'

export const R_PRECISION = 9

const UNKNOWN_REASON_ORDER: RiskUnknownReason[] = [
  'missing-loss-pnl',
  'result-conflict',
  'missing-policy',
  'missing-close-date',
  'invalid-close-date',
  'future-loss-close-date',
  'invalid-live-cycle-start',
]

const PARTIAL_REASON_ORDER: RiskPartialReason[] = [
  'partial-missing-pnl',
  'partial-missing-close-date',
  'partial-invalid-close-date',
  'partial-future-close-date',
  'partial-missing-policy',
]

export function quantizeR(value: number, digits = R_PRECISION): number {
  return quantizeDecimal(value, digits)
}

export function closedTradingDayKeyFromClosedAt(
  closedAt: string | null,
  tradingDayStartHour: number,
): string | null {
  if (!closedAt) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(closedAt)) {
    const parsed = parseLocalDate(closedAt)
    return formatYmd(parsed) === closedAt ? closedAt : null
  }
  if (!isCanonicalIsoInstant(closedAt)) return null
  const timestamp = new Date(closedAt)
  return Number.isNaN(timestamp.getTime()) ? null : getTradingDayKey(timestamp, tradingDayStartHour)
}

export interface ResolveRiskOutcomesInput {
  trades: Trade[]
  policies: RiskPolicyVersion[]
  monthlyLimits: MonthlyRiskLimit[]
  liveStageId: string
  liveStageStartsOn: string
  currentTradingDayKey: string
  /** @deprecated 运行时风险起点由 liveStageStartsOn 决定。 */
  liveStatsStartTradingDayKey?: string | null
  tradingDayStartHour?: number
}

export interface ResolvedRiskOutcomes {
  day: RiskPeriodOutcomeSnapshot
  week: RiskPeriodOutcomeSnapshot
  month: RiskPeriodOutcomeSnapshot
  gateCoverage: RiskCoverage
  unknownReasons: RiskUnknownReason[]
}

type CandidateResult = {
  tradeId: string | null
  tradeRef: string | null
  date: string | null
  budgetR: number | null
  unknownReasons: RiskUnknownReason[]
  partialReasons: RiskPartialReason[]
}

type RiskCandidateEvaluation = {
  results: CandidateResult[]
  globalReasons: RiskUnknownReason[]
}

function validDayKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return formatYmd(parseLocalDate(value)) === value
}

export function closedTradingDayKey(trade: Trade, tradingDayStartHour = 0): string | null {
  if (trade.closedTradingDayKey !== undefined) {
    return validDayKey(trade.closedTradingDayKey) ? trade.closedTradingDayKey : null
  }
  return closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour)
}

export function resolveTrustedBudgetPnl(trade: Trade): number | null {
  const source = resolveTradeResultSource(trade)
  const truth = resolveTradeTruth(trade)
  if (
    (source === 'pnl' || source === 'imported') &&
    typeof trade.pnl === 'number' &&
    Number.isFinite(trade.pnl) &&
    truth.isResultComplete &&
    !truth.hasConflict &&
    isTradeResultAuthorityConsistent(trade)
  ) return trade.pnl
  return null
}

function weekStart(day: string): string {
  const date = parseLocalDate(day)
  const distance = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - distance)
  return formatYmd(date)
}

function stableReasons(reasons: Iterable<RiskUnknownReason>): RiskUnknownReason[] {
  const found = new Set(reasons)
  return UNKNOWN_REASON_ORDER.filter((reason) => found.has(reason))
}

function stablePartialReasons(reasons: Iterable<RiskPartialReason>): RiskPartialReason[] {
  const found = new Set(reasons)
  return PARTIAL_REASON_ORDER.filter((reason) => found.has(reason))
}

function periodCoverage(results: CandidateResult[]): RiskCoverage {
  if (results.some((result) => result.unknownReasons.length > 0)) return 'unknown'
  return results.some((result) => result.partialReasons.length > 0) ? 'partial' : 'complete'
}

function limitR(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? quantizeR(value) : 0
}

function makeSnapshot(
  results: CandidateResult[],
  included: CandidateResult[],
  limit: number,
  reasons: RiskUnknownReason[],
): RiskPeriodOutcomeSnapshot {
  const netBudgetR = quantizeR(included.reduce((sum, result) => sum + (result.budgetR ?? 0), 0))
  const consumedR = quantizeR(Math.max(0, -netBudgetR))
  const remainingR = quantizeR(Math.max(0, limit - consumedR))
  const progress = limit > 0 ? Math.min(1, Math.max(0, consumedR / limit)) : 0
  const coverage = periodCoverage(results)
  return {
    netBudgetR,
    limitR: limit,
    consumedR,
    remainingR,
    progress,
    coverage,
    triggered: coverage !== 'unknown' && limit > 0 && netBudgetR <= -limit,
    includedTradeCount: included.length,
    excludedTradeCount: results.length - included.length,
    unknownReasons: reasons,
  }
}

function evaluateRiskCandidates(input: ResolveRiskOutcomesInput): RiskCandidateEvaluation {
  if (
    input.liveStageStartsOn > input.currentTradingDayKey
  ) {
    return { results: [], globalReasons: ['invalid-live-cycle-start'] }
  }
  const results: CandidateResult[] = []
  const currentCycleTrades = filterTradesForLiveCycle(
    input.trades.filter((trade) =>
      trade.tradeKind === 'live' && trade.liveStageId === input.liveStageId,
    ),
    'current',
    input.liveStageStartsOn,
    input.tradingDayStartHour ?? 0,
  )

  for (const trade of currentCycleTrades
    .filter((candidate) => candidate.tradeKind === 'live' && !candidate.deletedAt && isExecutedClosed(candidate.status))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const truth = resolveTradeTruth(trade)
    const reasons: RiskUnknownReason[] = []
    const partialReasons: RiskPartialReason[] = []
    let date = closedTradingDayKey(trade, input.tradingDayStartHour ?? 0)

    if (truth.hasConflict || !isTradeResultAuthorityConsistent(trade)) {
      reasons.push('result-conflict')
    }

    const trustedPnl = resolveTrustedBudgetPnl(trade)
    const knownLoss = trustedPnl !== null
      ? trustedPnl < 0
      : truth.outcome === 'loss' || trade.status === 'loss'
    if (trustedPnl === null && reasons.length === 0) {
      if (knownLoss) reasons.push('missing-loss-pnl')
      else partialReasons.push('partial-missing-pnl')
    }

    if (!date) {
      const dateReason: RiskUnknownReason = trade.closedAt ? 'invalid-close-date' : 'missing-close-date'
      if (knownLoss) reasons.push(dateReason)
      else partialReasons.push(trade.closedAt ? 'partial-invalid-close-date' : 'partial-missing-close-date')
    } else if (date > input.currentTradingDayKey) {
      if (knownLoss) reasons.push('future-loss-close-date')
      else partialReasons.push('partial-future-close-date')
      date = null
    }

    let budgetR: number | null = null
    if (trustedPnl !== null && date && reasons.length === 0) {
      const policy = activeRiskPolicy(input.policies, date, input.liveStageId)
      if (!policy || !Number.isFinite(policy.riskAmount) || toMoneyCents(policy.riskAmount) <= 0) {
        if (trustedPnl < 0) reasons.push('missing-policy')
        else partialReasons.push('partial-missing-policy')
      } else {
        budgetR = quantizeR(toMoneyCents(trustedPnl) / toMoneyCents(policy.riskAmount))
      }
    }

    results.push({
      tradeId: trade.id,
      tradeRef: trade.ref,
      date,
      budgetR,
      unknownReasons: stableReasons(reasons),
      partialReasons: stablePartialReasons(partialReasons),
    })
  }

  return { results, globalReasons: [] }
}

function calculateCanonicalOutcomes(input: ResolveRiskOutcomesInput): ResolvedRiskOutcomes {
  const currentPolicy = activeRiskPolicy(input.policies, input.currentTradingDayKey, input.liveStageId)
  const currentWeekStart = weekStart(input.currentTradingDayKey)
  const currentMonth = input.currentTradingDayKey.slice(0, 7)
  const monthlyLimit = input.monthlyLimits.find((limit) =>
    limit.liveStageId === input.liveStageId && limit.monthKey === currentMonth,
  )
  const evaluation = evaluateRiskCandidates(input)
  if (evaluation.globalReasons.length > 0) {
    const invalidResult: CandidateResult = {
      tradeId: null,
      tradeRef: null,
      date: null,
      budgetR: null,
      unknownReasons: evaluation.globalReasons,
      partialReasons: [],
    }
    const invalidSnapshot = (limit: number) => makeSnapshot(
      [invalidResult],
      [],
      limit,
      evaluation.globalReasons,
    )
    const day = invalidSnapshot(limitR(currentPolicy?.dailyLossLimitR))
    const week = invalidSnapshot(limitR(currentPolicy?.weeklyLossLimitR))
    const month = invalidSnapshot(limitR(monthlyLimit?.limitR))
    return { day, week, month, gateCoverage: 'unknown', unknownReasons: evaluation.globalReasons }
  }
  const results = evaluation.results

  const isCurrentDay = (result: CandidateResult) => result.date === input.currentTradingDayKey
  const isCurrentWeek = (result: CandidateResult) => result.date !== null && weekStart(result.date) === currentWeekStart
  const isCurrentMonth = (result: CandidateResult) => result.date?.slice(0, 7) === currentMonth
  const resultsFor = (matches: (result: CandidateResult) => boolean) => results.filter((result) =>
    matches(result) || (result.date === null && (result.partialReasons.length > 0 || result.unknownReasons.length > 0)),
  )
  const snapshotFor = (periodResults: CandidateResult[], limit: number) => makeSnapshot(
    periodResults,
    periodResults.filter((result) => result.budgetR !== null),
    limit,
    stableReasons(periodResults.flatMap((result) => result.unknownReasons)),
  )

  const day = snapshotFor(resultsFor(isCurrentDay), limitR(currentPolicy?.dailyLossLimitR))
  const week = snapshotFor(resultsFor(isCurrentWeek), limitR(currentPolicy?.weeklyLossLimitR))
  const month = snapshotFor(resultsFor(isCurrentMonth), limitR(monthlyLimit?.limitR))
  return {
    day,
    week,
    month,
    gateCoverage: month.coverage,
    unknownReasons: month.unknownReasons,
  }
}

export function resolveRiskOutcomes(input: ResolveRiskOutcomesInput): ResolvedRiskOutcomes {
  return calculateCanonicalOutcomes(input)
}

function compareRiskDataIssues(left: RiskDataIssue, right: RiskDataIssue): number {
  const severityOrder = { global: 0, blocking: 1, partial: 2 } as const
  return severityOrder[left.severity] - severityOrder[right.severity]
    || (left.tradingDayKey ?? '9999-12-31').localeCompare(right.tradingDayKey ?? '9999-12-31')
    || (left.tradeRef ?? '').localeCompare(right.tradeRef ?? '')
    || (left.tradeId ?? '').localeCompare(right.tradeId ?? '')
}

export function resolveRiskDataIssues(input: ResolveRiskOutcomesInput): RiskDataIssue[] {
  const evaluation = evaluateRiskCandidates(input)
  if (evaluation.globalReasons.length > 0) {
    return [{
      tradeId: null,
      tradeRef: null,
      tradingDayKey: null,
      severity: 'global',
      reasons: evaluation.globalReasons,
    }]
  }
  return evaluation.results.flatMap((result): RiskDataIssue[] => {
    const reasons = [...result.unknownReasons, ...result.partialReasons]
    if (reasons.length === 0) return []
    return [{
      tradeId: result.tradeId,
      tradeRef: result.tradeRef,
      tradingDayKey: result.date,
      severity: result.unknownReasons.length > 0 ? 'blocking' : 'partial',
      reasons,
    }]
  }).sort(compareRiskDataIssues)
}
