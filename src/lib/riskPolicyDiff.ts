import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { RiskPolicyBaselinePreview } from '@/lib/riskPolicy'
import { fmtMoney, fmtR } from '@/lib/format'

export type RiskPolicyDiffPresentation = Readonly<{
  summary: string
  monthlyImpact?: string
  changes: readonly string[]
}>

function valueChanges(previous: RiskPolicyVersion | null, next: RiskPolicyVersion): string[] {
  if (!previous) return []
  const changes: string[] = []
  if (previous.capitalBase !== next.capitalBase) changes.push(`资金基准：${fmtMoney(previous.capitalBase, 'USD')} → ${fmtMoney(next.capitalBase, 'USD')}`)
  if (previous.riskAmount !== next.riskAmount) changes.push(`1R：${fmtMoney(previous.riskAmount, 'USD')} → ${fmtMoney(next.riskAmount, 'USD')}`)
  if (previous.dailyLossLimitR !== next.dailyLossLimitR) changes.push(`日限额：${fmtR(previous.dailyLossLimitR)} → ${fmtR(next.dailyLossLimitR)}`)
  if (previous.weeklyLossLimitR !== next.weeklyLossLimitR) changes.push(`周限额：${fmtR(previous.weeklyLossLimitR)} → ${fmtR(next.weeklyLossLimitR)}`)
  if (previous.monthlyLossLimitRDefault !== next.monthlyLossLimitRDefault) changes.push(`未来月默认：${fmtR(previous.monthlyLossLimitRDefault)} → ${fmtR(next.monthlyLossLimitRDefault)}`)
  if (previous.disciplineText !== next.disciplineText) changes.push('纪律说明已修改')
  return changes
}

/** 只把领域预览翻译成文案；不计算日期或锁定范围。 */
export function presentRiskPolicyDiff(preview: RiskPolicyBaselinePreview, previous: RiskPolicyVersion | null): RiskPolicyDiffPresentation {
  return {
    summary: preview.firstPolicyForStage
      ? '本次配置今天生效，并创建、锁定当前月限额。'
      : `本次修改会生成新版本；资金基准、1R、日/周限额和纪律从 ${preview.policy.effectiveTradingDay} 起生效，此前交易不回写。`,
    monthlyImpact: preview.createsCurrentMonthLock
      ? undefined
      : '当前月限额已锁定，本次月限额修改只影响尚未锁定的未来月份。',
    changes: valueChanges(previous, preview.policy),
  }
}
