import type { RiskPeriodOutcomeSnapshot, RiskPolicyVersion } from '@/data/riskManagement'

export type WeeklyRiskTone = 'positive' | 'warning' | 'negative'

export function getWeeklyRiskStatus(outcome: RiskPeriodOutcomeSnapshot): {
  label: string
  hint: string
  tone: WeeklyRiskTone
} {
  if (outcome.triggered) return { label: '已触线', hint: '已达到冻结限制', tone: 'negative' }
  if (outcome.coverage === 'unknown') return { label: '无法确认', hint: '数据不完整，不能判断是否安全', tone: 'warning' }
  if (outcome.coverage === 'partial') return { label: '部分覆盖', hint: '按保守数值展示', tone: 'warning' }
  return { label: '未触线', hint: '风险空间仍可用', tone: 'positive' }
}

export function clampRiskProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
}

export function summarizeRiskPolicies(policies: RiskPolicyVersion[]): string {
  if (policies.length === 0) return '当周没有生效规则'
  const dates = policies.map((policy) => policy.effectiveTradingDay).sort()
  const short = (value: string) => value.slice(5)
  return policies.length === 1
    ? `1 个版本 · ${short(dates[0]!)}`
    : `${policies.length} 个版本 · ${short(dates[0]!)} 至 ${short(dates[dates.length - 1]!)}`
}
