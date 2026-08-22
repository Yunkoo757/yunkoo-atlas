import type { RiskPolicyVersion } from '@/data/riskManagement'
import { riskSetupStateForStage } from '@/lib/stageRisk'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function policy(liveStageId: string): RiskPolicyVersion {
  return {
    id: `policy-${liveStageId}`,
    liveStageId,
    sourceWeekStart: '2026-08-17',
    effectiveTradingDay: '2026-08-17',
    capitalBase: 100_000,
    riskPercent: 1,
    riskAmount: 1_000,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 5,
    monthlyLossLimitRDefault: 10,
    disciplineText: '遵守风险预算',
    confirmedAt: '2026-08-17T01:00:00.000Z',
  }
}

export function testArchivedRiskPolicyDoesNotConfigureNewStage(): void {
  const state = { riskPolicyVersions: [policy('stage-old')] }

  assert(
    riskSetupStateForStage(state, 'stage-new') === 'unconfigured',
    '旧阶段策略绝不能配置新阶段',
  )
}

export function testCurrentStagePolicyConfiguresOnlyItsOwnStage(): void {
  const state = { riskPolicyVersions: [policy('stage-current')] }

  assert(riskSetupStateForStage(state, 'stage-current') === 'configured', '当前阶段策略必须完成风险建档')
  assert(riskSetupStateForStage(state, 'stage-other') === 'unconfigured', '策略不得跨阶段生效')
}
