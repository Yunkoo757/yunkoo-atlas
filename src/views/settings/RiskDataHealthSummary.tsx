import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useRiskDataIssues } from '@/hooks/useRiskDataIssues'
import { buildRiskDataRepairQueue } from '@/lib/riskDataRepair'

export function RiskDataHealthSummary({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const issues = useRiskDataIssues(currentTradingDayKey)
  const queue = useMemo(() => buildRiskDataRepairQueue(issues), [issues])
  const actionLabel = queue.retainedOnly ? '查看历史缺口' : '开始修复'

  if (queue.counts.total === 0) return null

  return (
    <section className="settings-page-section risk-data-summary" data-risk-data-summary>
      <div className="risk-data-summary-counts" aria-label="风险数据缺口摘要">
        <span>待处理 {queue.counts.total} 项</span>
      </div>
      <div className="risk-data-summary-status">
        <span>{queue.retainedOnly ? '仅剩历史缺口' : '风险数据需要补全'}</span>
        <Link to="/settings/risk/data-repair">{actionLabel}</Link>
      </div>
    </section>
  )
}
