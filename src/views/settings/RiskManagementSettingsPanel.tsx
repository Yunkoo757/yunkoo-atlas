import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { RiskDataHealthSummary } from '@/views/settings/RiskDataHealthSummary'
import './RiskManagementSettingsPanel.css'

export function RiskManagementSettingsPanel() {
  const today = useLocalDateKey()

  return (
    <div className="settings-page risk-management-settings" data-risk-management-settings>
      <div className="settings-page-head">
        <h1 className="settings-page-title">风险管理</h1>
        <p className="settings-page-desc">配置资金基准、周期止损限额，并完成本周风险规则确认。</p>
      </div>
      <section className="settings-page-section">
        <div className="settings-page-head">
          <h2 className="settings-section-title">本周风险规则</h2>
          <p className="settings-section-desc">修改会保存为草稿；确认后按现有生效规则处理。</p>
        </div>
        <WeeklyRiskPreparationCard currentTradingDayKey={today} />
      </section>
      <RiskDataHealthSummary currentTradingDayKey={today} />
    </div>
  )
}
