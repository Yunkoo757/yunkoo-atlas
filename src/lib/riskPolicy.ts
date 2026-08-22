import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyDraft,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'
import { toMoneyCents } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/activeRiskPolicy'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'

export interface RiskPolicyState {
  currentLiveStageId: string
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
}

export interface ConfirmWeeklyRiskPreparationInput {
  currentTradingDayKey: string
  weekStart: string
  hasClosedLiveTradeOnDay: boolean
  draft: RiskPolicyDraft
  confirmedAt: string
  policyVersionId: string
}

function nextTradingDay(day: string): string {
  const date = parseLocalDate(day)
  date.setDate(date.getDate() + 1)
  return formatYmd(date)
}

function requireCanonicalDay(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || formatYmd(parseLocalDate(value)) !== value) {
    throw new Error(`${label}必须是 canonical YYYY-MM-DD`)
  }
  return value
}

function requireIsoTimestamp(value: string): string {
  if (!isCanonicalIsoInstant(value)) {
    throw new Error('confirmedAt 必须是合法 ISO 时间')
  }
  return value
}

function validateConfirmationInput(input: ConfirmWeeklyRiskPreparationInput): void {
  const currentTradingDayKey = requireCanonicalDay(input.currentTradingDayKey, 'currentTradingDayKey')
  const weekStart = requireCanonicalDay(input.weekStart, 'weekStart')
  if (weekStartFor(parseLocalDate(currentTradingDayKey)) !== weekStart) {
    throw new Error('weekStart 必须是当前业务日所属周的周一')
  }
  requireIsoTimestamp(input.confirmedAt)
  if (!input.policyVersionId.trim()) throw new Error('policyVersionId 不能为空')
}

function positiveFinite(value: number | null, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}必须是有限正数`)
  }
  return value
}

function canonicalDraft(draft: RiskPolicyDraft): Omit<RiskPolicyVersion, 'id' | 'liveStageId' | 'sourceWeekStart' | 'effectiveTradingDay' | 'confirmedAt'> {
  const capitalBase = positiveFinite(draft.capitalBase, '资金基准')
  const riskPercent = positiveFinite(draft.riskPercent, 'R 百分比')
  const dailyLossLimitR = positiveFinite(draft.dailyLossLimitR, '日止损线')
  const weeklyLossLimitR = positiveFinite(draft.weeklyLossLimitR, '周止损线')
  const monthlyLossLimitRDefault = positiveFinite(draft.monthlyLossLimitRDefault, '月止损线')
  const capitalCents = toMoneyCents(capitalBase)
  const riskAmountCents = toMoneyCents((capitalCents / 100) * riskPercent / 100)
  if (capitalCents <= 0 || riskAmountCents <= 0) throw new Error('riskAmount 必须至少为 1 美分')
  return {
    capitalBase: capitalCents / 100,
    riskPercent,
    riskAmount: riskAmountCents / 100,
    dailyLossLimitR,
    weeklyLossLimitR,
    monthlyLossLimitRDefault,
    disciplineText: draft.disciplineText,
  }
}

export { activeRiskPolicy } from '@/lib/activeRiskPolicy'

export function confirmWeeklyRiskPreparation(
  state: RiskPolicyState,
  input: ConfirmWeeklyRiskPreparationInput,
): RiskPolicyState {
  validateConfirmationInput(input)
  if (state.riskPolicyVersions.some((policy) => policy.id === input.policyVersionId)) {
    throw new Error('policyVersionId 已存在')
  }
  const policyValues = canonicalDraft(input.draft)
  const firstConfirmationForWeek = !state.riskPolicyVersions.some(
    (policy) => policy.liveStageId === state.currentLiveStageId && policy.sourceWeekStart === input.weekStart,
  )
  const effectiveTradingDay = firstConfirmationForWeek && !input.hasClosedLiveTradeOnDay
    ? input.currentTradingDayKey
    : nextTradingDay(input.currentTradingDayKey)
  const policy: RiskPolicyVersion = {
    id: input.policyVersionId,
    liveStageId: state.currentLiveStageId,
    sourceWeekStart: input.weekStart,
    effectiveTradingDay,
    ...policyValues,
    confirmedAt: input.confirmedAt,
  }
  const preparationId = `weekly-risk-preparation:${state.currentLiveStageId}:${input.weekStart}`
  const existingPreparation = state.weeklyRiskPreparations.find((item) =>
    item.liveStageId === state.currentLiveStageId && item.weekStart === input.weekStart,
  )
  const preparation: WeeklyRiskPreparation = {
    id: preparationId,
    liveStageId: state.currentLiveStageId,
    weekStart: input.weekStart,
    draft: { ...input.draft, riskAmount: policy.riskAmount },
    reviewedAt: input.confirmedAt,
    confirmedPolicyVersionId: policy.id,
    createdAt: existingPreparation?.createdAt ?? input.confirmedAt,
    updatedAt: input.confirmedAt,
  }
  return {
    ...state,
    weeklyRiskPreparations: existingPreparation
      ? state.weeklyRiskPreparations.map((item) => item === existingPreparation ? preparation : item)
      : [...state.weeklyRiskPreparations, preparation],
    riskPolicyVersions: [...state.riskPolicyVersions, policy],
  }
}

function appendLockedMonthlyLimit(
  state: RiskPolicyState,
  monthKey: string,
  policy: RiskPolicyVersion,
): RiskPolicyState {
  return {
    ...state,
    monthlyRiskLimits: [...state.monthlyRiskLimits, {
      id: `monthly-risk-limit:${state.currentLiveStageId}:${monthKey}`,
      liveStageId: state.currentLiveStageId,
      monthKey,
      limitR: policy.monthlyLossLimitRDefault,
      sourcePolicyVersionId: policy.id,
      lockedAt: policy.confirmedAt,
    }],
  }
}

export function ensureRiskPeriodRecords(
  state: RiskPolicyState,
  tradingDay: string,
): RiskPolicyState {
  requireCanonicalDay(tradingDay, 'tradingDay')
  const monthKey = tradingDay.slice(0, 7)
  if (state.monthlyRiskLimits.some((item) =>
    item.liveStageId === state.currentLiveStageId && item.monthKey === monthKey,
  )) return state
  const policy = activeRiskPolicy(state.riskPolicyVersions, tradingDay, state.currentLiveStageId)
  return policy ? appendLockedMonthlyLimit(state, monthKey, policy) : state
}
