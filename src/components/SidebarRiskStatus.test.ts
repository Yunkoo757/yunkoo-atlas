import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import {
  buildSidebarRiskGauge,
  buildSidebarRiskSummary,
  type SidebarRiskRow,
} from '@/components/SidebarRiskStatus'
import type { RiskStatusKind, RiskStatusPresentation } from '@/lib/riskStatus'

function outcome(consumedR: number, limitR: number, coverage: 'complete' | 'partial' | 'unknown' = 'complete'): RiskPeriodOutcomeSnapshot {
  return {
    netBudgetR: -consumedR,
    limitR,
    consumedR,
    remainingR: Math.max(0, limitR - consumedR),
    progress: limitR > 0 ? Math.min(1, consumedR / limitR) : 0,
    coverage,
    triggered: coverage !== 'unknown' && limitR > 0 && consumedR >= limitR,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
  }
}

const labels: Record<RiskStatusKind, RiskStatusPresentation['label']> = {
  normal: '正常',
  near: '接近限额',
  triggered: '已超限',
  partial: '待确认',
  unknown: '无法判断',
  unconfigured: '未配置',
}

function row(scope: RiskPeriodScope, kind: RiskStatusKind, consumedR: number, limitR: number): SidebarRiskRow {
  const names = {
    day: { shortLabel: '日', label: '今日' },
    week: { shortLabel: '周', label: '本周' },
    month: { shortLabel: '月', label: '本月' },
  }
  return {
    scope,
    ...names[scope],
    outcome: outcome(consumedR, limitR, kind === 'unknown' ? 'unknown' : kind === 'partial' ? 'partial' : 'complete'),
    presentation: { kind, label: labels[kind] },
  }
}

export function testSidebarRiskSummaryKeepsNormalStateCompact(): void {
  const summary = buildSidebarRiskSummary([
    row('day', 'normal', 0.6, 2),
    row('week', 'normal', 2.1, 5),
    row('month', 'normal', 3.8, 10),
  ])
  if (summary.kind !== 'normal' || summary.label !== '风控中心' || summary.value !== '余 1.4R') {
    throw new Error(`正常风险摘要不符合极简方案：${JSON.stringify(summary)}`)
  }
}

export function testSidebarRiskSummarySurfacesTheMostImportantConstraint(): void {
  const near = buildSidebarRiskSummary([
    row('day', 'normal', 0.6, 2),
    row('week', 'near', 4.6, 5),
    row('month', 'normal', 3.8, 10),
  ])
  if (near.kind !== 'near' || near.label !== '本周临界' || near.value !== '余 0.4R') {
    throw new Error(`临界风险没有提升到入口：${JSON.stringify(near)}`)
  }

  const triggered = buildSidebarRiskSummary([
    row('day', 'normal', 0.6, 2),
    row('week', 'triggered', 5.4, 5),
    row('month', 'partial', 3.8, 10),
  ])
  if (triggered.kind !== 'triggered' || triggered.label !== '已暂停交易' || triggered.value !== '周超 0.4R') {
    throw new Error(`超限状态没有覆盖较弱状态：${JSON.stringify(triggered)}`)
  }
}

export function testSidebarRiskSummaryNamesPartialCoverageAsDataConfirmation(): void {
  const summary = buildSidebarRiskSummary([
    row('day', 'normal', 0, 2),
    row('week', 'partial', 0, 5),
    row('month', 'normal', 0, 10),
  ])
  if (summary.kind !== 'partial' || summary.label !== '数据待确认') {
    throw new Error(`不完整风险数据不得被误写为流程复核：${JSON.stringify(summary)}`)
  }
}

export function testSidebarRiskGaugeUsesTheSelectedPeriodRemainingBudget(): void {
  const rows = [
    row('day', 'normal', 0.5, 2),
    row('week', 'near', 4, 5),
    row('month', 'normal', 2, 10),
  ]
  const daily = buildSidebarRiskGauge(rows, 'day')
  const weekly = buildSidebarRiskGauge(rows, 'week')
  const monthly = buildSidebarRiskGauge(rows, 'month')
  if (daily.remainingRatio !== 0.75 || daily.kind !== 'normal') {
    throw new Error(`每日圆环没有使用每日剩余额度：${JSON.stringify(daily)}`)
  }
  if (weekly.remainingRatio !== 0.2 || weekly.kind !== 'near') {
    throw new Error(`每周圆环没有使用每周剩余额度：${JSON.stringify(weekly)}`)
  }
  if (monthly.remainingRatio !== 0.8 || monthly.kind !== 'normal') {
    throw new Error(`每月圆环没有使用每月剩余额度：${JSON.stringify(monthly)}`)
  }
}

export function testSidebarRiskGaugeFallsBackSafelyWhenThePeriodIsUnavailable(): void {
  const gauge = buildSidebarRiskGauge([], 'week')
  if (gauge.kind !== 'unknown' || gauge.remainingRatio !== 0 || !gauge.ariaLabel.includes('本周')) {
    throw new Error(`圆环缺少周期数据时没有安全回退：${JSON.stringify(gauge)}`)
  }
}
