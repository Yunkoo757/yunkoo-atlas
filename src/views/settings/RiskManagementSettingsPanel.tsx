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
        <p className="settings-page-desc">为当前实盘阶段配置资金基准与周期止损限额；规则持续生效，修改时生成新版本。</p>
      </div>
      <section className="settings-page-section">
        <div className="settings-page-head">
          <h2 className="settings-section-title">当前阶段风险基准</h2>
          <p className="settings-section-desc">新阶段可沿用上一阶段配置；无需每周重复确认。</p>
        </div>
        <WeeklyRiskPreparationCard currentTradingDayKey={today} />
      </section>
      <RiskDataHealthSummary currentTradingDayKey={today} />
    </div>
  )
}
