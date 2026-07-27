import { useEffect, useMemo } from 'react'
import { AlertCircle, Gauge } from '@/icons/appIcons'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope, RiskPolicyVersion } from '@/data/riskManagement'
import { fmtMoney, fmtR } from '@/lib/format'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'
import './RiskBudgetCard.css'

const ROWS: Array<{ scope: RiskPeriodScope; label: string; ariaLabel: string }> = [
  { scope: 'day', label: '今日', ariaLabel: '今日止损预算' },
  { scope: 'week', label: '本周', ariaLabel: '本周止损预算' },
  { scope: 'month', label: '本月', ariaLabel: '本月止损预算' },
]

const COVERAGE_LABEL = {
  complete: '数据完整',
  partial: '部分覆盖',
  unknown: '覆盖未知',
} as const

function fmtBudgetR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

function tone(outcome: RiskPeriodOutcomeSnapshot): string {
  if (outcome.coverage === 'unknown') return 'is-unknown'
  if (outcome.triggered || outcome.progress >= 1) return 'is-triggered'
  if (outcome.progress >= 0.9) return 'is-near'
  if (outcome.progress >= 0.6) return 'is-watch'
  return 'is-normal'
}

function actionCopy(outcome: RiskPeriodOutcomeSnapshot): string {
  if (outcome.coverage === 'unknown') return '无法确认当前是否触线，请先补齐亏损金额或平仓日期。'
  if (outcome.limitR <= 0) return '尚未设置止损上限；请先完成本周风险准备。'
  if (outcome.triggered) return '已触及止损预算；继续开仓前必须逐笔说明原因。'
  if (outcome.progress >= 0.9) return '接近止损预算，下一笔开仓前先复核风险。'
  if (outcome.coverage === 'partial') return '按已确认结果保守计算，仍有盈利或日期未计入。'
  return '预算仍在纪律范围内。'
}

function nextScheduledPolicy(
  policies: readonly RiskPolicyVersion[],
  tradingDay: string,
): RiskPolicyVersion | null {
  return policies
    .filter((item) => item.effectiveTradingDay > tradingDay && Number.isFinite(Date.parse(item.confirmedAt)))
    .sort((left, right) =>
      left.effectiveTradingDay.localeCompare(right.effectiveTradingDay) ||
      Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt) ||
      left.id.localeCompare(right.id),
    )
    .at(0) ?? null
}

function RiskMeter({
  label,
  ariaLabel,
  outcome,
}: {
  label: string
  ariaLabel: string
  outcome: RiskPeriodOutcomeSnapshot
}) {
  const percentage = Math.round(outcome.progress * 100)
  return (
    <div
      className={`risk-budget-meter ${tone(outcome)}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      aria-valuetext={`${COVERAGE_LABEL[outcome.coverage]}，已用 ${fmtBudgetR(outcome.consumedR)}，${outcome.limitR > 0 ? `限额 ${fmtBudgetR(outcome.limitR)}` : '止损上限未设置'}`}
    >
      <div className="risk-budget-meter-head">
        <strong>{label}</strong>
        <span>净风险占用 {fmtR(outcome.netBudgetR)}</span>
        <em>{COVERAGE_LABEL[outcome.coverage]}</em>
      </div>
      <div className="risk-budget-track" aria-hidden>
        <span style={{ width: `${percentage}%` }} />
        <i className="risk-budget-mark is-sixty" />
        <i className="risk-budget-mark is-ninety" />
      </div>
      <div className="risk-budget-meter-facts">
        <span>已用 {fmtBudgetR(outcome.consumedR)}</span>
        <span>{outcome.limitR > 0 ? `限额 ${fmtBudgetR(outcome.limitR)}` : '上限 未设置'}</span>
        {outcome.coverage !== 'unknown' && outcome.limitR > 0 ? <span>剩余 {fmtBudgetR(outcome.remainingR)}</span> : null}
        <span>计入 {outcome.includedTradeCount} 笔</span>
        {outcome.excludedTradeCount > 0 ? <span>未计入 {outcome.excludedTradeCount} 笔</span> : null}
      </div>
      <p>{actionCopy(outcome)}</p>
    </div>
  )
}

export function RiskBudgetCard({
  currentTradingDayKey,
}: {
  currentTradingDayKey?: string
}) {
  const liveTradingDay = useLocalDateKey()
  const tradingDay = currentTradingDayKey ?? liveTradingDay
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const ensureRiskPeriodRecords = useStore((state) => state.ensureRiskPeriodRecords)
  useEffect(() => {
    ensureRiskPeriodRecords(tradingDay)
  }, [ensureRiskPeriodRecords, tradingDay])
  const outcomes = useMemo(() => resolveRiskOutcomes({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey: tradingDay,
  }), [trades, policies, monthlyLimits, tradingDay])
  const policy = useMemo(() => activeRiskPolicy(policies, tradingDay), [policies, tradingDay])
  const scheduledPolicy = useMemo(
    () => nextScheduledPolicy(policies, tradingDay),
    [policies, tradingDay],
  )

  return (
    <section className="risk-budget-card" data-risk-budget aria-labelledby="risk-budget-title">
      <header className="risk-budget-header">
        <span className="risk-budget-icon" aria-hidden><Gauge size={17} /></span>
        <div>
          <span className="risk-budget-eyebrow">交易前风控</span>
          <h2 id="risk-budget-title">风险预算</h2>
          <p>
            {policy
              ? `1R = ${privacyMode ? '****' : fmtMoney(policy.riskAmount)} · ${policy.riskPercent}% 资金风险`
              : scheduledPolicy
                ? `已确认规则将于 ${scheduledPolicy.effectiveTradingDay} 起生效；当前交易日不追溯计入。`
                : '尚未配置有效规则；先完成本周风险准备。'}
          </p>
        </div>
      </header>
      <div className="risk-budget-meters">
        {ROWS.map((row) => (
          <RiskMeter
            key={row.scope}
            label={row.label}
            ariaLabel={row.ariaLabel}
            outcome={outcomes[row.scope]}
          />
        ))}
      </div>
      <footer className="risk-budget-discipline">
        <AlertCircle size={14} aria-hidden />
        <span>{policy?.disciplineText || (scheduledPolicy
          ? `规则将在 ${scheduledPolicy.effectiveTradingDay} 起用于风险统计。`
          : '先确认资金基准、每 R 风险与三周期止损线。')}</span>
      </footer>
    </section>
  )
}
