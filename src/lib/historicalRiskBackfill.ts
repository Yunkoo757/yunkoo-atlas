import type { RiskPolicyDraft, RiskPolicyVersion, MonthlyRiskLimit } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'
import { activeRiskPolicy, isUsableRiskPolicy } from '@/lib/activeRiskPolicy'
import { canonicalDraft } from '@/lib/riskPolicy'
import { resolveRiskDataIssues, resolveRiskOutcomes } from '@/lib/riskBudget'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'

export interface HistoricalRiskState {
  trades: Trade[]
  liveStages: LiveStage[]
  currentLiveStageId: string
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  display: { tradingDayStartHour?: number }
}

export interface HistoricalRiskInput {
  startsOn: string
  today: string
  draft: RiskPolicyDraft
  sourcePolicyVersionId: string
  note: string
  confirmedAt: string
  policyVersionId: string
}

function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && formatYmd(parseLocalDate(day)) === day
}

export function historicalRiskFingerprint(state: HistoricalRiskState): string {
  return JSON.stringify([state.currentLiveStageId, state.liveStages, state.trades,
    state.riskPolicyVersions, state.monthlyRiskLimits, state.display.tradingDayStartHour])
}

export function previewHistoricalRiskBackfill(state: HistoricalRiskState, input: HistoricalRiskInput) {
  const stage = state.liveStages.find((item) => item.id === state.currentLiveStageId && item.status === 'current')
  if (!stage) throw new Error('当前实盘阶段已变化，请重新打开补录。')
  if (!validDay(input.startsOn) || !validDay(input.today)) throw new Error('请选择有效的历史起始日期。')
  if (!isCanonicalIsoInstant(input.confirmedAt) || !input.policyVersionId.trim()) throw new Error('补录时间或标识无效。')
  if (state.riskPolicyVersions.some((item) => item.id === input.policyVersionId)) throw new Error('此补录已保存，请刷新查看结果。')
  const source = state.riskPolicyVersions.find((item) => item.id === input.sourcePolicyVersionId &&
    item.liveStageId === stage.id && !item.historicalBackfill && isUsableRiskPolicy(item))
  if (!source) throw new Error('请先设置并保存当前阶段风险规则，再补录历史。')
  const first = state.riskPolicyVersions.filter((item) => item.liveStageId === stage.id && isUsableRiskPolicy(item))
    .sort((a, b) => a.effectiveTradingDay.localeCompare(b.effectiveTradingDay))[0]!
  if (input.startsOn < stage.startsOn || input.startsOn >= first.effectiveTradingDay || first.effectiveTradingDay > input.today) {
    throw new Error('补录须在当前阶段内，且早于首个已有规则；请先让当前规则生效。')
  }
  const end = parseLocalDate(first.effectiveTradingDay)
  end.setDate(end.getDate() - 1)
  const throughTradingDay = formatYmd(end)
  const policy: RiskPolicyVersion = {
    ...canonicalDraft(input.draft), id: input.policyVersionId, liveStageId: stage.id,
    sourceWeekStart: weekStartFor(parseLocalDate(input.startsOn)), effectiveTradingDay: input.startsOn,
    confirmedAt: input.confirmedAt,
    historicalBackfill: { confirmedHistorical: true, throughTradingDay,
      sourcePolicyVersionId: source.id, note: input.note.trim() },
  }
  const policies = [...state.riskPolicyVersions, policy]
  const monthlyLimits = [...state.monthlyRiskLimits]
  const newMonthlyLimits: MonthlyRiskLimit[] = []
  // 已锁定月份保持不变；只补齐历史区间内缺失的月上限。
  const month = parseLocalDate(input.startsOn.slice(0, 7) + '-01')
  while (formatYmd(month).slice(0, 7) <= throughTradingDay.slice(0, 7)) {
    const monthKey = formatYmd(month).slice(0, 7)
    if (!monthlyLimits.some((item) => item.liveStageId === stage.id && item.monthKey === monthKey)) {
      const limit: MonthlyRiskLimit = { id: `monthly-risk-limit:${stage.id}:${monthKey}`, liveStageId: stage.id,
        monthKey, limitR: policy.monthlyLossLimitRDefault, sourcePolicyVersionId: policy.id, lockedAt: input.confirmedAt }
      monthlyLimits.push(limit)
      newMonthlyLimits.push(limit)
    }
    month.setMonth(month.getMonth() + 1)
  }
  const base = { trades: state.trades, policies: state.riskPolicyVersions, monthlyLimits: state.monthlyRiskLimits,
    liveStageId: stage.id, liveStageStartsOn: stage.startsOn, currentTradingDayKey: input.today,
    tradingDayStartHour: state.display.tradingDayStartHour }
  const before = resolveRiskDataIssues(base)
  const after = resolveRiskDataIssues({ ...base, policies, monthlyLimits })
  const affected = before.filter((issue) => issue.tradingDayKey && issue.tradingDayKey >= input.startsOn &&
    issue.tradingDayKey <= throughTradingDay && issue.reasons.some((reason) => reason === 'missing-policy' || reason === 'partial-missing-policy'))
  if (!affected.length) throw new Error('该区间没有可补录的规则缺口，请重新选择起始日期。')
  const resolved = affected.filter((issue) => !after.some((remaining) => remaining.tradeId === issue.tradeId))
  if (activeRiskPolicy(policies, input.today, stage.id)?.id !== activeRiskPolicy(state.riskPolicyVersions, input.today, stage.id)?.id) {
    throw new Error('补录不得改变当前生效规则。')
  }
  return { policy, newMonthlyLimits, affected, resolved, remainingCount: after.length,
    beforeOutcomes: resolveRiskOutcomes(base), afterOutcomes: resolveRiskOutcomes({ ...base, policies, monthlyLimits }),
    fingerprint: historicalRiskFingerprint(state) }
}

export type HistoricalRiskPreview = ReturnType<typeof previewHistoricalRiskBackfill>
