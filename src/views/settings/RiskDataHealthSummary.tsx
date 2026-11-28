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
    <section className="settings-group risk-data-summary" data-risk-data-summary aria-labelledby="risk-data-summary-title">
      <div className="settings-group-head">
        <h2 id="risk-data-summary-title" className="settings-section-title">风险数据核对</h2>
      </div>
      <div className="settings-card">
        <div className="risk-data-summary-row">
          <div className="risk-data-summary-main">
            <span className="settings-row-title">发现待核对的风控记录</span>
            <div className="risk-data-summary-counts" aria-label="风险数据缺口摘要">
              {queue.actionableCount > 0 && <span>待处理 {queue.actionableCount} 项</span>}
              {queue.retainedCount > 0 && <span>历史缺口 {queue.retainedCount} 项</span>}
            </div>
          </div>
          <div className="risk-data-summary-status">
            <Link className="ui-btn ui-btn-bordered ui-btn-sm" to="/settings/risk/data-repair">{actionLabel}</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
