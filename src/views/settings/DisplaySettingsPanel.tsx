import { Check } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import '@/components/DisplayMenu.css'
import './DisplaySettingsPanel.css'

const SORT_OPTS: { value: DisplayPrefs['sortBy']; label: string }[] = [
  { value: 'date', label: '开仓日期' },
  { value: 'pnl', label: '盈亏金额' },
  { value: 'conviction', label: '信心度' },
]

export function DisplaySettingsPanel() {
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)

  return (
    <div className="settings-page display-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">显示偏好</h1>
        <p className="settings-page-desc">
          列表 / 看板 / 表格共用这些默认偏好。顶栏「显示」菜单可按当前视图快速调整。
        </p>
      </div>
      <div className="display-settings-card">
        <div className="display-label">列表与看板</div>
        <ToggleRow
          label="隐藏已平仓"
          checked={display.hideClosed}
          onChange={(v) => setDisplay({ hideClosed: v })}
        />
        <ToggleRow
          label="显示空分组"
          checked={display.showEmptyGroups}
          onChange={(v) => setDisplay({ showEmptyGroups: v })}
        />
        <ToggleRow
          label="按月份分组"
          checked={display.groupByDate}
          onChange={(v) =>
            setDisplay({
              groupByDate: v,
              groupByStrategy: v ? false : display.groupByStrategy,
            })
          }
        />
        <ToggleRow
          label="按策略分组"
          checked={display.groupByStrategy}
          onChange={(v) =>
            setDisplay({
              groupByStrategy: v,
              groupByDate: v ? false : display.groupByDate,
            })
          }
        />
        <div className="display-divider" />
        <div className="display-label">默认排序</div>
        {SORT_OPTS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={'display-item' + (display.sortBy === o.value ? ' is-on' : '')}
            onClick={() => setDisplay({ sortBy: o.value })}
          >
            <span>{o.label}</span>
            {display.sortBy === o.value && <Check size={14} />}
          </button>
        ))}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button type="button" className="display-toggle" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}
