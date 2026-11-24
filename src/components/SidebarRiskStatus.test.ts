import { buildSidebarRiskSummary, type SidebarRiskRow } from '@/components/SidebarRiskStatus'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import { presentRiskOutcome } from '@/lib/riskStatus'

function row(
  scope: RiskPeriodScope, consumedR: number, limitR: number,
  coverage: RiskPeriodOutcomeSnapshot['coverage'] = 'complete',
): SidebarRiskRow {
  const outcome: RiskPeriodOutcomeSnapshot = {
    netBudgetR: -consumedR, limitR, consumedR,
    remainingR: Math.max(0, limitR - consumedR),
    progress: limitR > 0 ? Math.min(1, consumedR / limitR) : 0,
    coverage,
    triggered: coverage !== 'unknown' && limitR > 0 && consumedR >= limitR,
    includedTradeCount: 1, excludedTradeCount: 0, unknownReasons: [],
  }
  return {
    scope, label: { day: '今日', week: '本周', month: '本月' }[scope],
    outcome, presentation: presentRiskOutcome(outcome),
  }
}

export function testSidebarRiskShowsRemainingBudgetForTheSavedPeriod(): void {
  const rows = [row('day', 0.6, 2), row('week', 2, 5), row('month', 3, 10)]
  for (const [period, expected] of [
    ['day', '今日余 1.4R'], ['week', '本周余 3R'], ['month', '本月余 7R'],
  ] as const) {
    const result = buildSidebarRiskSummary(rows, period)
    if (result?.row.scope !== period || result.value !== expected) {
      throw new Error(`摘要必须对应已选周期的剩余额度：${JSON.stringify(result)}`)
    }
  }
}

export function testSidebarRiskNamesThePeriodThatActuallyNeedsAttention(): void {
  const near = buildSidebarRiskSummary([row('day', 0, 2), row('week', 4.6, 5), row('month', 0, 0)], 'day')
  if (near?.value !== '本周余 0.4R' || near.row.presentation.kind !== 'near' || near.row.scope !== 'week') throw new Error('周额度临界时入口必须点名本周')
  const reached = buildSidebarRiskSummary([row('day', 2, 2), row('week', 5, 5)], 'week')
  if (reached?.value !== '本周已达限额') throw new Error('刚好用尽且同级时应保留已选周期')
  const exceeded = buildSidebarRiskSummary([row('day', 0, 2, 'unknown'), row('week', 5.4, 5)], 'day')
  if (exceeded?.value !== '本周已超限') throw new Error('已触发的周限额不能被另一周期缺数遮蔽')
}

export function testSidebarRiskKeepsIncompleteDataDistinctFromAnUnusedBudget(): void {
  for (const [coverage, label] of [['partial', '待确认'], ['unknown', '无法判断']] as const) {
    const result = buildSidebarRiskSummary([row('day', 0, 2, coverage)], 'day')
    if (result?.value !== '今日' + label) throw new Error('缺数时不能显示完整剩余额度')
  }
  const rows = [row('day', 0, 2), row('month', 0, 0)]
  const missing = buildSidebarRiskSummary(rows, 'month')
  if (missing?.value !== '本月未设置') throw new Error('单个周期未配置时不能伪造额度')
  if (buildSidebarRiskSummary(rows, 'day')?.value !== '今日余 2R') throw new Error('缺少月额度时仍应读到有效日额度')
  if (buildSidebarRiskSummary([], 'week') !== null) throw new Error('缺少周期时不能生成读数')
}
