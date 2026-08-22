import type { RiskPolicyVersion } from '@/data/riskManagement'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { hasCanonicalRiskAmount } from '@/lib/riskPolicyValidity'

function isCanonicalDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function isUsableRiskPolicy(policy: RiskPolicyVersion): boolean {
  return Boolean(policy.id.trim()) &&
    isCanonicalDay(policy.sourceWeekStart) &&
    isCanonicalDay(policy.effectiveTradingDay) &&
    hasCanonicalRiskAmount(policy) &&
    isPositiveFinite(policy.dailyLossLimitR) &&
    isPositiveFinite(policy.weeklyLossLimitR) &&
    isPositiveFinite(policy.monthlyLossLimitRDefault) &&
    typeof policy.disciplineText === 'string' &&
    isCanonicalIsoInstant(policy.confirmedAt)
}

function comparePolicyPrecedence(left: RiskPolicyVersion, right: RiskPolicyVersion): number {
  const confirmedDifference = Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt)
  return left.effectiveTradingDay.localeCompare(right.effectiveTradingDay) ||
    confirmedDifference ||
    left.id.localeCompare(right.id)
}

export function activeRiskPolicy(
  policies: readonly RiskPolicyVersion[],
  tradingDay: string,
  liveStageId: string,
): RiskPolicyVersion | null {
  return policies
    .filter((item) =>
      item.liveStageId === liveStageId &&
      item.effectiveTradingDay <= tradingDay &&
      isUsableRiskPolicy(item),
    )
    .sort(comparePolicyPrecedence)
    .at(-1) ?? null
}
