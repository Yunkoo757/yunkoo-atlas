import type {
  MonthlyRiskLimit,
  RiskCoverage,
  RiskPeriodOutcomeSnapshot,
  RiskPolicyVersion,
  RiskUnknownReason,
} from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { activeRiskPolicy } from '@/lib/activeRiskPolicy'
import { filterTradesForLiveCycle } from '@/lib/liveCycle'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { isExecutedClosed } from '@/lib/tradeStatus'
import {
  isTradeResultAuthorityConsistent,
  resolveTradeResultSource,
  resolveTradeTruth,
} from '@/lib/tradeTruth'

export const R_PRECISION = 9

const UNKNOWN_REASON_ORDER: RiskUnknownReason[] = [
  'missing-loss-pnl',
  'result-conflict',
  'missing-policy',
  'missing-close-date',
  'invalid-close-date',
  'future-loss-close-date',
]

function precisionFactor(digits: number): number {
  if (!Number.isInteger(digits) || digits < 0) throw new Error('精度必须是非负整数')
  const factor = 10 ** digits
  if (!Number.isFinite(factor) || !Number.isSafeInteger(factor)) {
    throw new Error('精度超出安全范围')
  }
  return factor
}

export function scaledIntegerFromDecimalNumber(value: number, digits: number): bigint {
  if (!Number.isFinite(value)) throw new Error('数值必须是有限数')
  precisionFactor(digits)
  const sign = value < 0 ? -1n : 1n
  const [coefficient, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e')
  const [whole, fraction = ''] = coefficient!.split('.')
  const source = BigInt(`${whole}${fraction}`)
  const sourceScale = fraction.length - Number(exponentText)
  if (sourceScale <= digits) return sign * source * (10n ** BigInt(digits - sourceScale))
  const divisor = 10n ** BigInt(sourceScale - digits)
  const quotient = source / divisor
  const remainder = source % divisor
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  return sign * rounded
}

export function toMoneyCents(value: number): number {
  const cents = scaledIntegerFromDecimalNumber(value, 2)
  const result = Number(cents)
  if (!Number.isSafeInteger(result)) throw new Error('金额超出安全范围')
  return result
}

export function quantizeR(value: number, digits = R_PRECISION): number {
  const factor = precisionFactor(digits)
  const scaled = Number(scaledIntegerFromDecimalNumber(value, digits))
  if (!Number.isSafeInteger(scaled)) throw new Error('R 数值超出安全范围')
  return scaled / factor
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
  const timestamp = new Date(closedAt)
  return Number.isNaN(timestamp.getTime()) ? null : getTradingDayKey(timestamp, tradingDayStartHour)
}

export interface ResolveRiskOutcomesInput {
  trades: Trade[]
  policies: RiskPolicyVersion[]
  monthlyLimits: MonthlyRiskLimit[]
  currentTradingDayKey: string
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
  date: string | null
  budgetR: number | null
  unknownReasons: RiskUnknownReason[]
  partial: boolean
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

function periodCoverage(results: CandidateResult[]): RiskCoverage {
  if (results.some((result) => result.unknownReasons.length > 0)) return 'unknown'
  return results.some((result) => result.partial) ? 'partial' : 'complete'
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

function calculateCanonicalOutcomes(input: ResolveRiskOutcomesInput): ResolvedRiskOutcomes {
  const currentPolicy = activeRiskPolicy(input.policies, input.currentTradingDayKey)
  const currentWeekStart = weekStart(input.currentTradingDayKey)
  const currentMonth = input.currentTradingDayKey.slice(0, 7)
  const monthlyLimit = input.monthlyLimits.find((limit) => limit.monthKey === currentMonth)
  const results: CandidateResult[] = []
  const currentCycleTrades = filterTradesForLiveCycle(
    input.trades,
    'current',
    input.liveStatsStartTradingDayKey ?? null,
    input.tradingDayStartHour ?? 0,
  )

  for (const trade of currentCycleTrades
    .filter((candidate) => candidate.tradeKind === 'live' && !candidate.deletedAt && isExecutedClosed(candidate.status))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const truth = resolveTradeTruth(trade)
    const reasons: RiskUnknownReason[] = []
    let partial = false
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
      else partial = true
    }

    if (!date) {
      const dateReason: RiskUnknownReason = trade.closedAt ? 'invalid-close-date' : 'missing-close-date'
      if (knownLoss) reasons.push(dateReason)
      else partial = true
    } else if (date > input.currentTradingDayKey) {
      if (knownLoss) reasons.push('future-loss-close-date')
      else partial = true
      date = null
    }

    let budgetR: number | null = null
    if (trustedPnl !== null && date && reasons.length === 0) {
      const policy = activeRiskPolicy(input.policies, date)
      if (!policy || !Number.isFinite(policy.riskAmount) || toMoneyCents(policy.riskAmount) <= 0) {
        if (trustedPnl < 0) reasons.push('missing-policy')
        else partial = true
      } else {
        budgetR = quantizeR(toMoneyCents(trustedPnl) / toMoneyCents(policy.riskAmount))
      }
    }

    results.push({ date, budgetR, unknownReasons: stableReasons(reasons), partial })
  }

  const isCurrentDay = (result: CandidateResult) => result.date === input.currentTradingDayKey
  const isCurrentWeek = (result: CandidateResult) => result.date !== null && weekStart(result.date) === currentWeekStart
  const isCurrentMonth = (result: CandidateResult) => result.date?.slice(0, 7) === currentMonth
  const resultsFor = (matches: (result: CandidateResult) => boolean) => results.filter((result) =>
    matches(result) || (result.date === null && (result.partial || result.unknownReasons.length > 0)),
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
