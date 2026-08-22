import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
import { activeRiskPolicy, isUsableRiskPolicy } from '@/lib/activeRiskPolicy'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'

export type StageRiskSetupState = 'unconfigured' | 'configured'

export interface StageRiskSetupSource {
  riskPolicyVersions: readonly RiskPolicyVersion[]
  monthlyRiskLimits: readonly MonthlyRiskLimit[]
}

export function forLiveStage<T extends { liveStageId?: string | null }>(
  entities: readonly T[],
  liveStageId: string,
): T[] {
  return entities.filter((entity) => entity.liveStageId === liveStageId)
}

export function riskSetupStateForStage(
  state: StageRiskSetupSource,
  liveStageId: string,
  tradingDay: string,
): StageRiskSetupState {
  const policy = activeRiskPolicy(state.riskPolicyVersions, tradingDay, liveStageId)
  if (!policy) return 'unconfigured'
  const monthKey = tradingDay.slice(0, 7)
  return state.monthlyRiskLimits.some((limit) =>
    limit.liveStageId === liveStageId &&
    limit.monthKey === monthKey &&
    (limit.id === `monthly-risk-limit:${monthKey}` ||
      limit.id === `monthly-risk-limit:${liveStageId}:${monthKey}`) &&
    Number.isFinite(limit.limitR) &&
    limit.limitR > 0 &&
    isCanonicalIsoInstant(limit.lockedAt) &&
    state.riskPolicyVersions.some((source) =>
      source.id === limit.sourcePolicyVersionId &&
      source.liveStageId === liveStageId &&
      isUsableRiskPolicy(source),
    ),
  ) ? 'configured' : 'unconfigured'
}
