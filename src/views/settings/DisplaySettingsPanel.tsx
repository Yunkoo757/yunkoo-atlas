import { ICON_SM } from '@/icons/iconSize'
import { useEffect, useState } from 'react'
import { Check } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import { TRADING_DAY_START_HOUR_OPTIONS } from '@/lib/periods'
import {
  WINDOW_SIZE_PRESETS,
  type WindowSizePresetId,
} from '@/lib/windowBounds'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { WindowFrameState, WindowsClosePreference } from '@/types/journal-bridge'
import '@/components/DisplayMenu.css'
import './DisplaySettingsPanel.css'

function getSortOptions(
  sortBy: DisplayPrefs['sortBy'],
  direction: DisplayPrefs['sortDirection'],
): {
  value: DisplayPrefs['sortBy']
  label: string
  description: string
}[] {
  const isAscending = (value: DisplayPrefs['sortBy']) => value === sortBy && direction === 'asc'
  return [
    { value: 'date', label: '最近交易', description: `按开仓时间，${isAscending('date') ? '旧记录在前' : '新记录在前'}` },
    { value: 'pnl', label: '盈亏表现', description: `按盈亏金额，${isAscending('pnl') ? '从低到高' : '从高到低'}` },
    { value: 'conviction', label: '交易信心', description: `按信心度，${isAscending('conviction') ? '从低到高' : '从高到低'}` },
  ]
}

const TRADING_DAY_OPTS = TRADING_DAY_START_HOUR_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  description: option.description,
}))

type GroupMode = 'date' | 'strategy' | 'none'

const GROUP_OPTS: { value: GroupMode; label: string; description: string }[] = [
  { value: 'date', label: '按月份', description: '按开仓月份组织交易' },
  { value: 'strategy', label: '按策略', description: '按所属策略组织交易' },
  { value: 'none', label: '不分组', description: '连续显示全部交易' },
]

const LIST_DENSITY_OPTS: {
  value: DisplayPrefs['listRowDensity']
  label: string
  description: string
}[] = [
  { value: 'compact', label: '紧凑 · 44px', description: '同屏显示更多交易与案例' },
  { value: 'comfortable', label: '舒展 · 48px', description: '增加行间留白，更易逐行浏览' },
]

const WINDOWS_CLOSE_OPTIONS: {
  value: WindowsClosePreference
  label: string
  description: string
}[] = [
  { value: 'ask', label: '每次询问', description: '首次关闭时说明差异并让你选择' },
  { value: 'tray', label: '隐藏到系统托盘', description: '关闭主窗口后继续保护和自动备份资料库' },
  { value: 'quit', label: '彻底退出', description: '安全保存完成后结束 Trader Atlas' },
]

export function DisplaySettingsPanel() {
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const electron = isElectron()
  const bridge = getJournalBridge()
  const windows = electron && bridge?.platform === 'win32'
  const [windowState, setWindowState] = useState<WindowFrameState | null>(null)
  const [windowsClosePreference, setWindowsClosePreference] =
    useState<WindowsClosePreference>('ask')
  const [windowMessage, setWindowMessage] = useState('')
  const groupMode: GroupMode = display.groupByDate
    ? 'date'
    : display.groupByStrategy
      ? 'strategy'
      : 'none'

  const setGroupMode = (mode: GroupMode) => {
    setDisplay({
      groupByDate: mode === 'date',
      groupByStrategy: mode === 'strategy',
      ...(mode === 'none' ? {} : { sortBy: 'date' as const }),
    })
  }

  useEffect(() => {
    if (!electron) return
    let cancelled = false
    void getJournalBridge()
      ?.getWindowState()
      .then((state) => {
        if (!cancelled) setWindowState(state)
      })
      .catch(() => {
        if (!cancelled) setWindowState(null)
      })
    return () => {
      cancelled = true
    }
  }, [electron])

  useEffect(() => {
    if (!windows || !bridge) return
    let cancelled = false
    void bridge.getWindowsClosePreference().then((preference) => {
      if (!cancelled) setWindowsClosePreference(preference)
    })
    return () => { cancelled = true }
  }, [bridge, windows])

  const applyWindowPreset = async (presetId: WindowSizePresetId) => {
    const bridge = getJournalBridge()
    if (!bridge) return
    setWindowMessage('')
    const result = await bridge.applyWindowPreset(presetId)
    if (!result.ok) {
      setWindowMessage(result.error)
      return
    }
    setWindowState(result.state)
  }

  const applyWindowResizeLock = async (locked: boolean) => {
    const bridge = getJournalBridge()
    if (!bridge) return
    setWindowMessage('')
    const result = await bridge.setWindowResizable(!locked)
    if (!result.ok) {
      setWindowMessage(result.error)
      return
    }
    setWindowState(result.state)
  }

  const currentSizeLabel = windowState
    ? windowState.isMaximized
      ? '当前：最大化'
      : `当前：${windowState.width} × ${windowState.height}`
    : ''

  const applyWindowsClosePreference = async (preference: WindowsClosePreference) => {
    if (!bridge) return
    const saved = await bridge.setWindowsClosePreference(preference)
    setWindowsClosePreference(saved)
  }

  return (
    <div className="settings-page settings-page--form display-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">显示偏好</h1>
        <p className="settings-page-description">顶栏「显示」与此处共用同一组偏好。</p>
      </div>
      <div className="display-settings-card">
        <section className="display-settings-section">
          <div className="display-section-head">
            <h2>显示内容</h2>
            <p>控制默认保留哪些记录与空状态。</p>
          </div>
          <ToggleRow
            label="只看未结束交易"
            description="隐藏盈利、亏损与保本的已结束记录"
            checked={display.hideClosed}
            onChange={(v) => setDisplay({ hideClosed: v })}
          />
          <ToggleRow
            label="保留空状态"
            description="显示没有交易的看板列与列表分组"
            checked={display.showEmptyGroups}
            onChange={(v) => setDisplay({ showEmptyGroups: v })}
          />
          <ToggleRow
            label="直播模式"
            description="直播或分享屏幕时隐藏所有现金盈亏与权益金额，保留结果状态和 R 倍数"
            checked={display.privacyMode}
            onChange={(v) => setDisplay({ privacyMode: v })}
          />
        </section>

        <section className="display-settings-section">
          <div className="display-settings-section-heading display-section-head">
            <h2>交互反馈</h2>
          </div>
          <ToggleRow
            label="显示键盘焦点高光"
            description="使用 Tab 或键盘导航时，以轮廓标出当前控件。关闭后仍可使用全部键盘操作。"
            checked={display.showKeyboardFocusRings}
            onChange={(checked) => setDisplay({ showKeyboardFocusRings: checked })}
          />
        </section>

        <ChoiceSection
          title="列表密度"
          hint="应用于交易日志和案例库。"
          options={LIST_DENSITY_OPTS}
          value={display.listRowDensity}
          onChange={(value) => setDisplay({ listRowDensity: value })}
        />

        <ChoiceSection
          title="交易日开始于"
          hint="凌晨开平仓仍算前一交易日。影响今日工作台、今日筛选与新建默认日期；统计分析「本周」等仍按日历周。"
          options={TRADING_DAY_OPTS}
          value={display.tradingDayStartHour}
          onChange={(value) => setDisplay({ tradingDayStartHour: value })}
        />

        <ChoiceSection
          title="分组方式"
          hint="决定交易日志的第一层结构。"
          options={GROUP_OPTS}
          value={groupMode}
          onChange={setGroupMode}
        />

        <ChoiceSection
          title="默认排序"
          hint="决定每个列表或分组内的交易顺序；再次点击当前项可切换正序或倒序。"
          options={getSortOptions(display.sortBy, display.sortDirection)}
          value={display.sortBy}
          onChange={(value) => {
            const selected = value === display.sortBy
            setDisplay({
              sortBy: value,
              sortDirection: selected
                ? display.sortDirection === 'asc' ? 'desc' : 'asc'
                : 'desc',
              ...(value === 'date' ? {} : { groupByDate: false, groupByStrategy: false }),
            })
          }}
        />

        {electron ? (
          <section className="display-settings-section">
            <div className="display-section-head">
              <h2>主窗口尺寸</h2>
              <p>
                一键套用常用分辨率；可按需锁定边缘拖拽，下次启动仍会记住。
                {currentSizeLabel ? ` ${currentSizeLabel}` : ''}
              </p>
            </div>
            <div className="display-choice-list" role="listbox" aria-label="主窗口尺寸预置">
              {WINDOW_SIZE_PRESETS.map((preset) => {
                const selected = windowState?.presetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={'display-choice' + (selected ? ' is-selected' : '')}
                    aria-pressed={selected}
                    onClick={() => void applyWindowPreset(preset.id)}
                  >
                    <span className="display-row-copy">
                      <span className="display-row-title">{preset.label}</span>
                      <span className="display-row-desc">{preset.description}</span>
                    </span>
                    <span className="display-choice-check">
                      {selected ? <Check size={ICON_SM} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
            <ToggleRow
              label="锁定窗口大小"
              description="禁止拖拽窗口边缘缩放；上方尺寸预置仍然可用"
              checked={windowState?.resizable === false}
              onChange={(locked) => void applyWindowResizeLock(locked)}
            />
            {windowMessage ? (
              <p className="display-settings-hint" role="status">
                {windowMessage}
              </p>
            ) : null}
          </section>
        ) : null}

        {windows ? (
          <ChoiceSection
            title="关闭主窗口"
            hint="仅适用于 Windows。macOS 遵循系统习惯：关闭窗口后保留 Dock，使用 ⌘Q 才退出应用。"
            options={WINDOWS_CLOSE_OPTIONS}
            value={windowsClosePreference}
            onChange={(preference) => void applyWindowsClosePreference(preference)}
          />
        ) : null}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="display-toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="display-row-copy">
        <span className="display-row-title">{label}</span>
        <span className="display-row-desc">{description}</span>
      </span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}

function ChoiceSection<T extends string | number>({
  title,
  hint,
  options,
  value,
  onChange,
}: {
  title: string
  hint: string
  options: { value: T; label: string; description: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <section className="display-settings-section">
      <div className="display-section-head">
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <div className="display-choice-list">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={'display-choice' + (value === option.value ? ' is-selected' : '')}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            <span className="display-row-copy">
              <span className="display-row-title">{option.label}</span>
              <span className="display-row-desc">{option.description}</span>
            </span>
            <span className="display-choice-check">
              {value === option.value && <Check size={ICON_SM} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
