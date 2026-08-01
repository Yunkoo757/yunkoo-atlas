import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, WeeklyRiskReviewSnapshot } from '@/data/riskManagement'
import { fmtR } from '@/lib/format'
import { RISK_UNKNOWN_REASON_COPY } from '@/lib/riskUnknownReasonPresentation'
import {
  clampRiskProgress,
  getWeeklyRiskStatus,
  summarizeRiskPolicies,
} from '@/lib/weeklyRiskPresentation'
import { tradeDetailPath } from '@/lib/tradeRoute'

interface PeriodDecisionProps {
  label: string
  outcome: RiskPeriodOutcomeSnapshot
  primary?: boolean
}

function PeriodDecision({ label, outcome, primary = false }: PeriodDecisionProps) {
  const status = getWeeklyRiskStatus(outcome)
  const progress = clampRiskProgress(outcome.progress)
  const style = { '--risk-progress': `${progress * 100}%` } as CSSProperties
  return (
    <article className={`wr-risk-period${primary ? ' is-primary' : ''}`} data-risk-tone={status.tone}>
      <div className="wr-risk-period-head"><span>{label}</span><strong>{status.label}</strong></div>
      <div className="wr-risk-remaining"><b>{fmtR(outcome.remainingR)}</b><span>剩余</span></div>
      <p>{fmtR(outcome.consumedR)} 已使用 / {fmtR(outcome.limitR)} 限制</p>
      <div
        className="wr-risk-track"
        style={style}
        role="progressbar"
        aria-label={`${label}：${status.label}，${fmtR(outcome.consumedR)} 已使用 / ${fmtR(outcome.limitR)} 限制，${status.hint}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <i aria-hidden />
      </div>
      <small>{status.hint}</small>
    </article>
  )
}

interface WeeklyRiskEvidenceProps {
  snapshot?: WeeklyRiskReviewSnapshot
  availability?: 'draft' | 'legacy'
}

export function WeeklyRiskEvidence({
  snapshot,
  availability = 'legacy',
}: WeeklyRiskEvidenceProps): JSX.Element {
  if (!snapshot) {
    const draft = availability === 'draft'
    return (
      <section className="wr-section wr-risk-evidence" data-risk-availability={availability}>
        <div className="wr-section-head">
          <div><span>R</span><h2>风控执行</h2></div>
          <small>{draft ? '完成复盘后冻结' : '历史记录'}</small>
        </div>
        <div className="wr-risk-unavailable">
          <strong>{draft ? '完成复盘后生成风控证据' : '历史记录未包含风控快照'}</strong>
          <span>
            {draft
              ? '完成时会固化本周、月度和每日风险轨迹。'
              : '该周完成早于风控证据功能，保留原始记录且不回填推测数据。'}
          </span>
        </div>
      </section>
    )
  }
  const policySummary = summarizeRiskPolicies(snapshot.policyVersions)
  const confirmationSummary = snapshot.overrideEvents.length
    ? `${snapshot.overrideEvents.length} 条继续交易确认`
    : '本周无继续交易确认'

  return (
    <section className="wr-section wr-risk-evidence">
      <div className="wr-section-head"><div><span>R</span><h2>风控执行</h2></div><small>完成时冻结证据</small></div>
      <div className="wr-risk-decisions">
        <PeriodDecision label="本周风险状态" outcome={snapshot.weeklyOutcome} primary />
        <PeriodDecision label="完成时月度状态" outcome={snapshot.monthlyOutcomeAtCompletion} />
      </div>
      <div className="wr-risk-daily">
        <h3>每日风险轨迹</h3>
        {snapshot.dailyOutcomes.map((outcome) => {
          const status = getWeeklyRiskStatus(outcome)
          const reasonSummary = outcome.coverage === 'complete'
            ? null
            : outcome.unknownReasons.map((reason) => RISK_UNKNOWN_REASON_COPY[reason]).join('、')
          return (
          <article className="wr-risk-day" data-risk-tone={status.tone} key={outcome.date}>
            <span className="wr-risk-day-date">{outcome.date}</span>
            <strong>{fmtR(outcome.netBudgetR)}</strong>
            <span className="wr-risk-day-status">{status.label}</span>
            {reasonSummary ? <small className="wr-risk-day-reasons">原因：{reasonSummary}</small> : null}
          </article>
          )
        })}
      </div>
      <div className="wr-risk-audits">
        <h3>冻结审计</h3>
        <details className="wr-risk-audit">
          <summary>规则版本 · {policySummary}</summary>
          {snapshot.policyVersions.length ? snapshot.policyVersions.map((policy) => (
            <p key={policy.id}>{policy.effectiveTradingDay} 生效 · {policy.disciplineText || '未填写纪律文本'} · {policy.id}</p>
          )) : <p>当周没有生效规则</p>}
        </details>
        <details className="wr-risk-audit">
          <summary>继续交易确认 · {confirmationSummary}</summary>
          {snapshot.overrideEvents.length ? snapshot.overrideEvents.map((event) => (
            <article key={event.id}>
              <p>{event.reason}</p>
              <small>
                {event.tradeIdentityAtDecision.ref} · {event.tradeIdentityAtDecision.symbol} · {event.linkState === 'resolved' ? '已关联' : '关联未解析'}
                {event.linkState === 'resolved' ? <> · <Link to={tradeDetailPath(event.tradeIdentityAtDecision)}>查看交易</Link></> : null}
              </small>
            </article>
          )) : <p>展开后无继续交易确认。</p>}
        </details>
      </div>
    </section>
  )
}
