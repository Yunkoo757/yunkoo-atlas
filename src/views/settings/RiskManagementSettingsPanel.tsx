import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { RiskDataHealthSummary } from '@/views/settings/RiskDataHealthSummary'
import './RiskManagementSettingsPanel.css'

export function RiskManagementSettingsPanel() {
  const today = useLocalDateKey()

  return (
    <div className="settings-page settings-page--reading risk-management-settings" data-risk-management-settings>
      <div className="settings-page-head">
        <h1 className="settings-page-title">风险管理</h1>
      </div>
      <section className="settings-page-section">
        <WeeklyRiskPreparationCard currentTradingDayKey={today} />
      </section>
      <RiskDataHealthSummary currentTradingDayKey={today} />
    </div>
  )
}
