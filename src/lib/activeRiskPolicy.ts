import { isCalendarDay } from '@/lib/calendarDay'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { hasCanonicalRiskAmount } from '@/lib/riskPolicyValidity'

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function isUsableRiskPolicy(policy: RiskPolicyVersion): boolean {
  return Boolean(policy.id.trim()) &&
    isCalendarDay(policy.sourceWeekStart) &&
    isCalendarDay(policy.effectiveTradingDay) &&
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
