import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyDraft,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'
import { toMoneyCents } from '@/lib/riskBudget'
import { formatYmd, parseLocalDate } from '@/lib/periods'

export interface RiskPolicyState {
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

function comparePolicyPrecedence(left: RiskPolicyVersion, right: RiskPolicyVersion): number {
  return left.effectiveTradingDay.localeCompare(right.effectiveTradingDay) ||
    left.confirmedAt.localeCompare(right.confirmedAt) ||
    left.id.localeCompare(right.id)
}

function nextTradingDay(day: string): string {
  const date = parseLocalDate(day)
  date.setDate(date.getDate() + 1)
  return formatYmd(date)
}

function positiveFinite(value: number | null, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}必须是有限正数`)
  }
  return value
}

function canonicalDraft(draft: RiskPolicyDraft): Omit<RiskPolicyVersion, 'id' | 'sourceWeekStart' | 'effectiveTradingDay' | 'confirmedAt'> {
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

export function activeRiskPolicy(
  policies: readonly RiskPolicyVersion[],
  tradingDay: string,
): RiskPolicyVersion | null {
  return policies
    .filter((item) => item.effectiveTradingDay <= tradingDay)
    .sort(comparePolicyPrecedence)
    .at(-1) ?? null
}

export function confirmWeeklyRiskPreparation(
  state: RiskPolicyState,
  input: ConfirmWeeklyRiskPreparationInput,
): RiskPolicyState {
  if (state.riskPolicyVersions.some((policy) => policy.id === input.policyVersionId)) {
    throw new Error('policyVersionId 已存在')
  }
  const policyValues = canonicalDraft(input.draft)
  const firstConfirmationForWeek = !state.riskPolicyVersions.some(
    (policy) => policy.sourceWeekStart === input.weekStart,
  )
  const effectiveTradingDay = firstConfirmationForWeek && !input.hasClosedLiveTradeOnDay
    ? input.currentTradingDayKey
    : nextTradingDay(input.currentTradingDayKey)
  const policy: RiskPolicyVersion = {
    id: input.policyVersionId,
    sourceWeekStart: input.weekStart,
    effectiveTradingDay,
    ...policyValues,
    confirmedAt: input.confirmedAt,
  }
  const preparationId = `weekly-risk-preparation:${input.weekStart}`
  const existingPreparation = state.weeklyRiskPreparations.find((item) => item.id === preparationId)
  const preparation: WeeklyRiskPreparation = {
    id: preparationId,
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
      ? state.weeklyRiskPreparations.map((item) => item.id === preparationId ? preparation : item)
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
      id: `monthly-risk-limit:${monthKey}`,
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
  const monthKey = tradingDay.slice(0, 7)
  if (state.monthlyRiskLimits.some((item) => item.monthKey === monthKey)) return state
  const policy = activeRiskPolicy(state.riskPolicyVersions, tradingDay)
  return policy ? appendLockedMonthlyLimit(state, monthKey, policy) : state
}
