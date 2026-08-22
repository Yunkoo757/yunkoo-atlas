import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
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

function monthlyLimit(liveStageId: string): MonthlyRiskLimit {
  return {
    id: `monthly-risk-limit:${liveStageId}:2026-08`,
    liveStageId,
    monthKey: '2026-08',
    limitR: 10,
    sourcePolicyVersionId: `policy-${liveStageId}`,
    lockedAt: '2026-08-17T01:00:00.000Z',
  }
}

export function testArchivedRiskPolicyDoesNotConfigureNewStage(): void {
  const state = {
    riskPolicyVersions: [policy('stage-old')],
    monthlyRiskLimits: [monthlyLimit('stage-old')],
  }

  assert(
    riskSetupStateForStage(state, 'stage-new', '2026-08-17') === 'unconfigured',
    '旧阶段策略绝不能配置新阶段',
  )
}

export function testCurrentStagePolicyConfiguresOnlyItsOwnStage(): void {
  const state = {
    riskPolicyVersions: [policy('stage-current')],
    monthlyRiskLimits: [monthlyLimit('stage-current')],
  }

  assert(riskSetupStateForStage(state, 'stage-current', '2026-08-17') === 'configured', '当前阶段策略必须完成风险建档')
  assert(riskSetupStateForStage(state, 'stage-other', '2026-08-17') === 'unconfigured', '策略不得跨阶段生效')
}

export function testRepairedNullPrefixMonthlyLimitConfiguresStageByOwnershipAndSource(): void {
  const repairedLimit = {
    ...monthlyLimit('stage-current'),
    id: 'monthly-risk-limit:null:2026-08',
  }

  assert(
    riskSetupStateForStage({
      riskPolicyVersions: [policy('stage-current')],
      monthlyRiskLimits: [repairedLimit],
    }, 'stage-current', '2026-08-17') === 'configured',
    '修复后的 null 前缀月限额必须按归属字段、月份与来源策略被风险建档消费，不得依赖实体 ID 猜归属',
  )
}

export function testRiskSetupRequiresActiveValidPolicyAndLockedCurrentMonth(): void {
  const valid = policy('stage-current')
  const base = { monthlyRiskLimits: [monthlyLimit('stage-current')] }

  assert(
    riskSetupStateForStage({ ...base, riskPolicyVersions: [{ ...valid, effectiveTradingDay: '2026-08-18' }] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '未来策略不得提前完成风险建档',
  )
  assert(
    riskSetupStateForStage({ ...base, riskPolicyVersions: [{ ...valid, confirmedAt: 'not-an-instant' }] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '非法确认时间不得完成风险建档',
  )
  assert(
    riskSetupStateForStage({ ...base, riskPolicyVersions: [{ ...valid, effectiveTradingDay: '0000-00-00' }] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '非法生效业务日不得完成风险建档',
  )
  assert(
    riskSetupStateForStage({ ...base, riskPolicyVersions: [{ ...valid, riskAmount: Number.NaN }] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '非法风险数值不得完成风险建档',
  )
  assert(
    riskSetupStateForStage({ ...base, riskPolicyVersions: [{ ...valid, riskAmount: 999 }] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '与资金基数和风险比例不一致的风险金额不得完成风险建档',
  )
  assert(
    riskSetupStateForStage({ riskPolicyVersions: [valid], monthlyRiskLimits: [] }, 'stage-current', '2026-08-17') === 'unconfigured',
    '首个有效策略尚未锁定当月限额时仍未完成建档',
  )
  assert(
    riskSetupStateForStage({
      riskPolicyVersions: [valid],
      monthlyRiskLimits: [{ ...monthlyLimit('stage-current'), limitR: Number.NaN }],
    }, 'stage-current', '2026-08-17') === 'unconfigured',
    '非法月限额不得完成风险建档',
  )
  assert(
    riskSetupStateForStage({
      riskPolicyVersions: [valid],
      monthlyRiskLimits: [{ ...monthlyLimit('stage-current'), sourcePolicyVersionId: 'missing-policy' }],
    }, 'stage-current', '2026-08-17') === 'unconfigured',
    '月限额来源策略缺失时不得完成风险建档',
  )
}
