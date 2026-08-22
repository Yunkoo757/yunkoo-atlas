import type { RiskPolicyVersion } from '@/data/riskManagement'

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
      Number.isFinite(Date.parse(item.confirmedAt)),
    )
    .sort(comparePolicyPrecedence)
    .at(-1) ?? null
}
