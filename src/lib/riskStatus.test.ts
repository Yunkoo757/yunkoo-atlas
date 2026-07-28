import type { RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'
import {
  presentRiskOutcome,
  summarizeRiskStatus,
  type RiskStatusRow,
} from '@/lib/riskStatus'

function outcome(patch: Partial<RiskPeriodOutcomeSnapshot> = {}): RiskPeriodOutcomeSnapshot {
  return {
    netBudgetR: -0.8,
    limitR: 2,
    consumedR: 0.8,
    remainingR: 1.2,
    progress: 0.4,
    coverage: 'complete',
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
    ...patch,
  }
}

export function testRiskStatusPresentationUsesFailClosedPrecedence(): void {
  if (presentRiskOutcome(outcome({ limitR: 0 })).kind !== 'unconfigured') {
    throw new Error('invalid limit must be unconfigured')
  }
  if (presentRiskOutcome(outcome({ coverage: 'unknown' })).kind !== 'unknown') {
    throw new Error('unknown coverage must not be presented as safe')
  }
  if (presentRiskOutcome(outcome({ coverage: 'unknown', limitR: 0 })).kind !== 'unknown') {
    throw new Error('unknown coverage must outrank an unconfigured limit')
  }
  if (presentRiskOutcome(outcome({ coverage: 'partial', triggered: true, progress: 1 })).kind !== 'triggered') {
    throw new Error('a confirmed breach must outrank partial coverage')
  }
  if (presentRiskOutcome(outcome({ coverage: 'partial' })).kind !== 'partial') {
    throw new Error('partial coverage must require confirmation')
  }
  if (presentRiskOutcome(outcome({ progress: 0.9 })).kind !== 'near') {
    throw new Error('90 percent must be near the limit')
  }
  if (presentRiskOutcome(outcome()).kind !== 'normal') {
    throw new Error('complete low usage must be normal')
  }
}

export function testRiskStatusSummaryKeepsPeriodOrderAndNamesSafePeriods(): void {
  const rows: RiskStatusRow[] = [
    { periodLabel: '今日', presentation: presentRiskOutcome(outcome({ triggered: true, progress: 1 })) },
    { periodLabel: '本周', presentation: presentRiskOutcome(outcome()) },
    { periodLabel: '本月', presentation: presentRiskOutcome(outcome({ coverage: 'partial' })) },
  ]
  const summary = summarizeRiskStatus(rows)
  if (summary !== '今日已超限，本月数据待确认；本周仍在限额内。') {
    throw new Error(`unexpected summary: ${summary}`)
  }
  const allNormal = rows.map((row) => ({
    ...row,
    presentation: presentRiskOutcome(outcome()),
  }))
  if (summarizeRiskStatus(allNormal) !== '日、周、月均在风险限额内。') {
    throw new Error('all-normal summary must remain stable')
  }
}
