import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useRiskDataIssues } from '@/hooks/useRiskDataIssues'
import { buildRiskDataRepairQueue } from '@/lib/riskDataRepair'

export function RiskDataHealthSummary({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const issues = useRiskDataIssues(currentTradingDayKey)
  const queue = useMemo(() => buildRiskDataRepairQueue(issues), [issues])
  const actionLabel = queue.retainedOnly ? '查看历史缺口' : '开始修复'

  if (queue.counts.total === 0) {
    return (
      <section className="settings-page-section risk-data-summary" data-risk-data-summary data-risk-data-complete>
        <strong>风险数据完整</strong>
        <span>当前没有需要处理的数据问题</span>
      </section>
    )
  }

  return (
    <section className="settings-page-section risk-data-summary" data-risk-data-summary>
      <div className="risk-data-summary-counts" aria-label="风险数据缺口摘要">
        <span>全局设置 {queue.counts.global}</span>
        <span>阻断判断 {queue.counts.blocking}</span>
        <span>影响完整度 {queue.counts.partial}</span>
      </div>
      <div className="risk-data-summary-status">
        <span>{queue.retainedOnly ? '历史风险规则缺口仍会如实影响完整度。' : '请前往修复中心处理待修复的数据缺口。'}</span>
        <Link to="/settings/risk/data-repair">{actionLabel}</Link>
      </div>
    </section>
  )
}
