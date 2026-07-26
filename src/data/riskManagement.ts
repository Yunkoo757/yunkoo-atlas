import type { TradeKind } from '@/data/trades'

export type RiskPeriodScope = 'day' | 'week' | 'month'

export type RiskCoverage = 'complete' | 'partial' | 'unknown'

export type RiskUnknownReason =
  | 'missing-loss-pnl'
  | 'result-conflict'
  | 'missing-policy'
  | 'missing-close-date'
  | 'invalid-close-date'
  | 'future-loss-close-date'

export interface RiskPolicyDraft {
  capitalBase: number | null
  riskPercent: number
  riskAmount: number | null
  dailyLossLimitR: number
  weeklyLossLimitR: number
  monthlyLossLimitRDefault: number
  disciplineText: string
}

export interface RiskPeriodOutcomeSnapshot {
  netBudgetR: number
  limitR: number
  consumedR: number
  remainingR: number
  progress: number
  coverage: RiskCoverage
  triggered: boolean
  includedTradeCount: number
  excludedTradeCount: number
  unknownReasons: RiskUnknownReason[]
}

export interface WeeklyRiskPreparation {
  id: string
  weekStart: string
  draft: RiskPolicyDraft
  reviewedAt: string | null
  confirmedPolicyVersionId: string | null
  createdAt: string
  updatedAt: string
}

export interface RiskPolicyVersion {
  id: string
  sourceWeekStart: string
  effectiveTradingDay: string
  capitalBase: number
  riskPercent: number
  riskAmount: number
  dailyLossLimitR: number
  weeklyLossLimitR: number
  monthlyLossLimitRDefault: number
  disciplineText: string
  confirmedAt: string
}

export interface MonthlyRiskLimit {
  id: string
  monthKey: string
  limitR: number
  sourcePolicyVersionId: string
  lockedAt: string
}

export type RiskDecisionType = 'triggered' | 'unknown'

export interface RiskOverrideEvent {
  id: string
  tradeId: string
  tradeIdentityAtDecision: {
    ref: string
    symbol: string
    tradeKind: Extract<TradeKind, 'live'>
  }
  linkState: 'resolved' | 'unresolved'
  decisionType: RiskDecisionType
  tradingDayKeyAtDecision: string
  policyVersionId: string | null
  createdAt: string
  reason: string
  fingerprint: string
  outcomesAtDecision: Record<RiskPeriodScope, RiskPeriodOutcomeSnapshot>
  unknownReasons: RiskUnknownReason[]
}

export interface WeeklyRiskReviewSnapshot {
  policyVersions: RiskPolicyVersion[]
  dailyOutcomes: Array<RiskPeriodOutcomeSnapshot & { date: string }>
  weeklyOutcome: RiskPeriodOutcomeSnapshot
  monthlyOutcomeAtCompletion: RiskPeriodOutcomeSnapshot
  overrideEvents: RiskOverrideEvent[]
  frozenAt: string
}
