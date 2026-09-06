import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { RiskDataHealthSummary } from '@/views/settings/RiskDataHealthSummary'
import type { SidebarRiskScope } from '@/lib/tradeFilters'
import { useStore } from '@/store/useStore'
import './RiskManagementSettingsPanel.css'

const RISK_SCOPE_OPTIONS: ReadonlyArray<{ value: SidebarRiskScope; label: string }> = [
  { value: 'day', label: '每日' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
]

export function RiskManagementSettingsPanel() {
  const today = useLocalDateKey()
  const riskScope = useStore((state) => state.display.sidebarRiskScope ?? 'day')
  const setDisplay = useStore((state) => state.setDisplay)

  return (
    <div className="settings-page settings-page--form risk-management-settings" data-risk-management-settings>
      <div className="settings-page-head">
        <h1 className="settings-page-title">风险管理</h1>
      </div>
      <section className="risk-indicator-setting">
        <strong>侧栏额度环</strong>
        <SegmentedControl
          className="risk-indicator-options" role="radiogroup" label="侧栏风险圆环周期"
          value={riskScope} onChange={(value) => setDisplay({ sidebarRiskScope: value })}
          options={RISK_SCOPE_OPTIONS}
        />
      </section>
      <section className="settings-page-section">
        <WeeklyRiskPreparationCard currentTradingDayKey={today} />
      </section>
      <RiskDataHealthSummary currentTradingDayKey={today} />
    </div>
  )
}
