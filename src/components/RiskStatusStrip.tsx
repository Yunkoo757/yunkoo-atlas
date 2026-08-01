import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import { weekStartFor } from '@/data/weeklyReviews'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { fmtR } from '@/lib/format'
import { parseLocalDate } from '@/lib/periods'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { presentRiskOutcome, summarizeRiskStatus, type RiskStatusPresentation } from '@/lib/riskStatus'
import { useStore } from '@/store/useStore'
import './RiskStatusStrip.css'

const PERIODS: ReadonlyArray<{ scope: RiskPeriodScope; label: string; ariaLabel: string }> = [
  { scope: 'day', label: '今日', ariaLabel: '今日止损预算' },
  { scope: 'week', label: '本周', ariaLabel: '本周止损预算' },
  { scope: 'month', label: '本月', ariaLabel: '本月止损预算' },
]

function formatBudgetR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

function scopedPeriodLabel(
  scope: RiskPeriodScope,
  label: string,
  liveStart: string | null,
  tradingDay: string,
): string {
  if (!liveStart || liveStart > tradingDay) return label
  const periodStart = scope === 'day'
    ? tradingDay
    : scope === 'week'
      ? weekStartFor(parseLocalDate(tradingDay))
      : `${tradingDay.slice(0, 7)}-01`
  if (scope === 'month' && liveStart < periodStart) {
    return `${label} · ${Number(tradingDay.slice(5, 7))}月1日重置`
  }
  return liveStart > periodStart
    ? `${label} · 自${Number(liveStart.slice(5, 7))}月${Number(liveStart.slice(8, 10))}日起`
    : label
}

function detailCopy(outcome: RiskPeriodOutcomeSnapshot): string {
  const status = presentRiskOutcome(outcome)
  if (status.kind === 'unconfigured') return '止损上限未设置'
  if (status.kind === 'unknown') return '需要补齐风险数据'
  if (status.kind === 'partial') return '数据未完整覆盖'
  if (status.kind === 'triggered') {
    const excessR = outcome.consumedR - outcome.limitR
    return excessR > 0 ? `超出 ${formatBudgetR(excessR)}` : '已触及限额'
  }
  return `剩余 ${formatBudgetR(outcome.remainingR)}`
}

function RiskPeriod({
  label,
  ariaLabel,
  outcome,
  presentation,
  requiresReview,
  constrainedBy,
}: {
  label: string
  ariaLabel: string
  outcome: RiskPeriodOutcomeSnapshot
  presentation: RiskStatusPresentation
  requiresReview?: boolean
  constrainedBy?: string
}) {
  const constrained = Boolean(constrainedBy) && (
    presentation.kind === 'normal' || presentation.kind === 'near'
  )
  const display = constrained
    ? {
        kind: 'constrained',
        label: `受${constrainedBy}限制`,
        detail: `账面剩余 ${formatBudgetR(outcome.remainingR)}`,
      }
    : presentation.label === '待复核'
    ? { ...presentation, detail: '本周规则未确认' }
    : {
        ...presentation,
        detail: `${detailCopy(outcome)}${requiresReview ? ' · 本周规则未确认' : ''}`,
      }
  const percentage = Math.round(Math.min(1, Math.max(0, outcome.progress)) * 100)
  return (
    <div className={`risk-status-period is-${display.kind}`} data-risk-period data-risk-state={display.kind}>
      <div className="risk-status-period-head">
        <span>{label}</span>
        <strong>{display.label}</strong>
      </div>
      <div
        className="risk-status-track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="risk-status-values">
        <span><strong>{formatBudgetR(outcome.consumedR)}</strong> / {outcome.limitR > 0 ? formatBudgetR(outcome.limitR) : '—'}</span>
        <span>{display.detail}</span>
      </div>
    </div>
  )
}

export function RiskStatusStrip({ currentTradingDayKey }: { currentTradingDayKey?: string }) {
  const liveTradingDay = useLocalDateKey()
  const tradingDay = currentTradingDayKey ?? liveTradingDay
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const preparations = useStore((state) => state.weeklyRiskPreparations)
  const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const ensureRiskPeriodRecords = useStore((state) => state.ensureRiskPeriodRecords)

  useEffect(() => ensureRiskPeriodRecords(tradingDay), [ensureRiskPeriodRecords, tradingDay])

  const outcomes = useMemo(() => resolveRiskOutcomes({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey: tradingDay,
    liveStatsStartTradingDayKey,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, tradingDay, liveStatsStartTradingDayKey, tradingDayStartHour])
  const currentWeek = weekStartFor(parseLocalDate(tradingDay))
  const reviewed = preparations.some((item) =>
    item.weekStart === currentWeek && Boolean(item.reviewedAt && item.confirmedPolicyVersionId))
  const policy = activeRiskPolicy(policies, tradingDay)
  const rows = PERIODS.map((period) => {
    const outcome = outcomes[period.scope]
    const resolvedPresentation = presentRiskOutcome(outcome)
    const requiresReview = period.scope === 'week' && !reviewed
    const presentation: RiskStatusPresentation = requiresReview && (
      resolvedPresentation.kind === 'normal' || resolvedPresentation.kind === 'near'
    )
      ? { kind: 'partial', label: '待复核' }
      : resolvedPresentation
    return {
      ...period,
      displayLabel: scopedPeriodLabel(period.scope, period.label, liveStatsStartTradingDayKey, tradingDay),
      outcome,
      presentation,
      requiresReview,
    }
  })
  const needsRecovery = !policy || !reviewed || rows.some((row) =>
    row.presentation.kind === 'unknown' ||
    row.presentation.kind === 'partial' ||
    row.presentation.kind === 'unconfigured')
  const summaryRows = rows.map((row) => ({
    periodLabel: row.label,
    presentation: row.presentation,
  }))
  const triggeredRows = rows.filter((row) => row.presentation.kind === 'triggered')
  const blockingRow = triggeredRows[0]
  const remainingSummaryRows = summaryRows.filter((row) => row.presentation.kind !== 'triggered')
  const crossMonthWeeklyConstraint = blockingRow?.scope === 'week' &&
    rows.some((row) => row.scope === 'month' && row.displayLabel.includes('重置'))
  const summary = triggeredRows.length > 0
    ? [
        `${triggeredRows.map((row) => row.label).join('、')}已超限，当前暂停开仓。`,
        remainingSummaryRows.length > 0 ? summarizeRiskStatus(remainingSummaryRows) : null,
        crossMonthWeeklyConstraint ? '月度重置不会解除本周限制。' : null,
      ].filter(Boolean).join(' ')
    : summarizeRiskStatus(summaryRows)

  return (
    <section className="risk-status-strip" data-risk-status aria-labelledby="risk-status-title">
      <header className="risk-status-head"><h2 id="risk-status-title">风险状态</h2></header>
      <div className="risk-status-periods">
        {rows.map((row) => (
          <RiskPeriod
            key={row.scope}
            label={row.displayLabel}
            ariaLabel={row.ariaLabel}
            outcome={row.outcome}
            presentation={row.presentation}
            requiresReview={row.requiresReview}
            constrainedBy={row.presentation.kind !== 'triggered' ? blockingRow?.label : undefined}
          />
        ))}
      </div>
      <footer className="risk-status-summary">
        <span>{summary}</span>
        {needsRecovery ? <Link to="/settings/risk">前往风险管理</Link> : null}
      </footer>
    </section>
  )
}
