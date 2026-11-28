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

      <section className="settings-group" aria-label="风险基准">
        <div className="settings-card">
          <WeeklyRiskPreparationCard currentTradingDayKey={today} />
        </div>
      </section>

      <section className="settings-group" aria-label="侧栏展示">
        <div className="settings-group-head">
          <h2 className="settings-section-title">侧栏展示</h2>
        </div>
        <div className="settings-card">
          <section className="settings-row risk-indicator-setting">
            <div className="settings-row-copy">
              <strong>侧栏默认周期</strong>
              <span className="settings-row-desc">左下角风险额度卡片默认展示的统计周期</span>
            </div>
            <div className="settings-row-control">
              <SegmentedControl
                className="risk-indicator-options" role="radiogroup" label="侧栏默认周期"
                value={riskScope} onChange={(value) => setDisplay({ sidebarRiskScope: value })}
                options={RISK_SCOPE_OPTIONS}
              />
            </div>
          </section>
        </div>
      </section>

      <RiskDataHealthSummary currentTradingDayKey={today} />
    </div>
  )
}
