import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { resolveRiskDataIssues } from '@/lib/riskBudget'
import { riskDataIssueReasonCopy } from '@/lib/riskUnknownReasonPresentation'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { useStore } from '@/store/useStore'

export function RiskDataIssuesSection({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const cycleStart = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const issues = useMemo(() => resolveRiskDataIssues({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey,
    liveStatsStartTradingDayKey: cycleStart,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, currentTradingDayKey, cycleStart, tradingDayStartHour])
  const blockingCount = issues.filter((issue) => issue.severity !== 'partial').length
  const partialCount = issues.filter((issue) => issue.severity === 'partial').length
  const tradesById = useMemo(() => new Map(trades.map((trade) => [trade.id, trade])), [trades])

  return (
    <section className="settings-page-section risk-data-issues" data-risk-data-issues>
      <div className="settings-page-head risk-data-issues-head">
        <div>
          <h2 className="settings-section-title">待修复数据</h2>
          <p className="settings-section-desc">修复当前风险周期的数据缺口，风险状态会自动重新核算。</p>
        </div>
        {issues.length > 0 ? (
          <div className="risk-data-issues-summary" aria-label="风险数据缺口摘要">
            <span className={blockingCount > 0 ? 'is-blocking' : ''}>阻断风险判断 {blockingCount} 条</span>
            <span className={partialCount > 0 ? 'is-partial' : ''}>影响完整度 {partialCount} 条</span>
          </div>
        ) : null}
      </div>

      {issues.length === 0 ? (
        <div className="risk-data-complete" data-risk-data-complete>
          <strong>当前风险周期数据完整</strong>
          <span>暂无需要修复的交易数据</span>
        </div>
      ) : (
        <div className="risk-data-issue-list">
          {issues.map((issue) => {
            if (issue.severity === 'global') {
              return (
                <article className="risk-data-issue is-global" key={`global:${issue.reasons.join(',')}`}>
                  <div>
                    <strong>全局设置</strong>
                    <p>{issue.reasons.map(riskDataIssueReasonCopy).join('；')}</p>
                  </div>
                  <Link className="risk-data-issue-action" to="/settings/data">调整核算起点</Link>
                </article>
              )
            }
            const trade = issue.tradeId ? tradesById.get(issue.tradeId) : undefined
            if (!trade) return null
            return (
              <article className={`risk-data-issue is-${issue.severity}`} key={trade.id}>
                <div className="risk-data-issue-body">
                  <div className="risk-data-issue-title">
                    <strong>{trade.ref}</strong>
                    <span>{trade.symbol}</span>
                    <small>{issue.severity === 'blocking' ? '阻断判断' : '影响完整度'}</small>
                  </div>
                  <p>{issue.reasons.map(riskDataIssueReasonCopy).join('；')}</p>
                  {issue.reasons.includes('missing-policy') ? (
                    <small className="risk-data-issue-note">历史规则无法通过编辑交易补建，请先核对交易事实。</small>
                  ) : null}
                </div>
                <Link
                  className="risk-data-issue-action"
                  data-risk-issue-trade={trade.id}
                  to={tradeDetailPath(trade)}
                  state={tradeDetailNavState({
                    pathname: '/settings/risk',
                    search: '',
                    anchorTradeId: trade.id,
                  })}
                >
                  打开交易
                </Link>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
