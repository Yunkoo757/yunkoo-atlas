import type { RiskPolicyVersion } from '@/data/riskManagement'

export type StageRiskSetupState = 'unconfigured' | 'configured'

export interface StageRiskSetupSource {
  riskPolicyVersions: readonly RiskPolicyVersion[]
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
): StageRiskSetupState {
  return state.riskPolicyVersions.some((policy) => policy.liveStageId === liveStageId)
    ? 'configured'
    : 'unconfigured'
}
