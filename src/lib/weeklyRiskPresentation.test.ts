import type { RiskPeriodOutcomeSnapshot, RiskPolicyVersion } from '@/data/riskManagement'
import {
  clampRiskProgress,
  getWeeklyRiskStatus,
  summarizeRiskPolicies,
} from '@/lib/weeklyRiskPresentation'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function outcome(overrides: Partial<RiskPeriodOutcomeSnapshot> = {}): RiskPeriodOutcomeSnapshot {
  return {
    netBudgetR: -1,
    limitR: 5,
    consumedR: 1,
    remainingR: 4,
    progress: 0.2,
    coverage: 'complete',
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
    ...overrides,
  }
}

export function testWeeklyRiskStatusUsesApprovedPriorityAndWords(): void {
  assert(getWeeklyRiskStatus(outcome({ triggered: true, coverage: 'unknown' })).label === '已触线', '触线必须优先')
  assert(getWeeklyRiskStatus(outcome({ coverage: 'unknown' })).label === '无法确认', '未知覆盖文案错误')
  assert(getWeeklyRiskStatus(outcome({ coverage: 'partial' })).label === '部分覆盖', '部分覆盖文案错误')
  assert(getWeeklyRiskStatus(outcome()).label === '未触线', '完整未触线文案错误')
}

export function testWeeklyRiskProgressIsFiniteAndClamped(): void {
  assert(clampRiskProgress(-1) === 0, '负进度必须钳制为 0')
  assert(clampRiskProgress(0.35) === 0.35, '合法进度不得改写')
  assert(clampRiskProgress(2) === 1, '超限进度必须钳制为 1')
  assert(clampRiskProgress(Number.NaN) === 0, '非法进度必须安全回退')
}

export function testRiskPolicySummaryUsesCountAndEffectiveRange(): void {
  const policies = [
    { id: 'p1', effectiveTradingDay: '2026-07-27' },
    { id: 'p2', effectiveTradingDay: '2026-07-29' },
  ] as RiskPolicyVersion[]
  assert(summarizeRiskPolicies([]) === '当周没有生效规则', '空规则摘要错误')
  assert(summarizeRiskPolicies(policies) === '2 个版本 · 07-27 至 07-29', '规则日期摘要错误')
}
