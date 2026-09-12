import { ICON_SM } from '@/icons/iconSize'
import { Check } from '@/icons/appIcons'
import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import { TRADING_DAY_START_HOUR_OPTIONS } from '@/lib/periods'
import {
  WINDOW_SIZE_PRESETS,
  type WindowSizePresetId,
} from '@/lib/windowBounds'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { AutoLaunchState, WindowFrameState, WindowsClosePreference } from '@/types/journal-bridge'
import { toast } from '@/lib/toast'
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
  { value: 'compact', label: '紧凑', description: '同屏显示更多交易与案例' },
  { value: 'comfortable', label: '舒展', description: '增加行间留白，更易逐行浏览' },
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
  const [autoLaunchState, setAutoLaunchState] = useState<AutoLaunchState | null>(null)
  const [autoLaunchBusy, setAutoLaunchBusy] = useState(false)
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

  const loadAutoLaunchState = async () => {
    if (!bridge) return
    try {
      setAutoLaunchState(await bridge.getAutoLaunchState())
    } catch {
      setAutoLaunchState({
        supported: true,
        enabled: false,
        error: '无法读取系统开机启动状态',
      })
    }
  }

  useEffect(() => {
    if (!electron || !bridge) return
    let cancelled = false
    void bridge.getAutoLaunchState()
      .then((state) => { if (!cancelled) setAutoLaunchState(state) })
      .catch(() => {
        if (!cancelled) {
          setAutoLaunchState({
            supported: true,
            enabled: false,
            error: '无法读取系统开机启动状态',
          })
        }
      })
    return () => { cancelled = true }
  }, [bridge, electron])

  const applyAutoLaunch = async (enabled: boolean) => {
    if (!bridge || autoLaunchBusy) return
    setAutoLaunchBusy(true)
    try {
      const state = await bridge.setAutoLaunchEnabled(enabled)
      setAutoLaunchState(state)
      if (state.error) toast(state.error)
      else toast(enabled ? '已开启开机自动启动' : '已关闭开机自动启动')
    } catch {
      toast('开机启动设置失败，请重试')
      await loadAutoLaunchState()
    } finally {
      setAutoLaunchBusy(false)
    }
  }

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
      </div>
      <div className="display-settings-card">
        <section className="display-settings-section">
          <div className="display-section-head">
            <h2>显示内容</h2>
          </div>
          <ToggleRow
            label="只看未结束交易"
            checked={display.hideClosed}
            onChange={(v) => setDisplay({ hideClosed: v })}
          />
          <ToggleRow
            label="显示空分组与空看板列"
            checked={display.showEmptyGroups}
            onChange={(v) => setDisplay({ showEmptyGroups: v })}
          />
          <ToggleRow
            label="直播模式"
            description="隐藏金额，保留结果与 R 倍数"
            checked={display.privacyMode}
            onChange={(v) => setDisplay({ privacyMode: v })}
          />
        </section>

        {electron ? (
          <section className="display-settings-section" data-auto-launch-setting>
            <div className="display-settings-section-heading display-section-head">
              <h2>应用行为</h2>
            </div>
            <ToggleRow
              label="开机自动启动"
              checked={autoLaunchState?.enabled ?? false}
              disabled={autoLaunchBusy || !autoLaunchState || !autoLaunchState.supported || Boolean(autoLaunchState.error)}
              onChange={(checked) => void applyAutoLaunch(checked)}
            />
            {autoLaunchState?.error ? (
              <div className="display-setting-feedback">
                <p className="display-settings-hint" role="status">{autoLaunchState.error}</p>
                <button
                  type="button"
                  className="ui-btn ui-btn-bordered"
                  disabled={autoLaunchBusy}
                  onClick={() => void loadAutoLaunchState()}
                >
                  重试读取
                </button>
              </div>
            ) : null}
          </section>
        ) : null}


        <ChoiceSection
          title="列表密度"
          options={LIST_DENSITY_OPTS}
          value={display.listRowDensity}
          onChange={(value) => setDisplay({ listRowDensity: value })}
        />

        <ChoiceSection
          title="交易日开始于"
          hint="该时刻前计入前一交易日；统计中的周、月仍按日历计算。"
          options={TRADING_DAY_OPTS}
          value={display.tradingDayStartHour}
          onChange={(value) => setDisplay({ tradingDayStartHour: value })}
        />

        <ChoiceSection
          title="分组方式"
          options={GROUP_OPTS}
          value={groupMode}
          onChange={setGroupMode}
        />

        <ChoiceSection
          title="默认排序"
          hint="再次点击当前排序可切换升序 / 降序。"
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
              description="尺寸预置仍可使用"
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
  disabled = false,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="display-toggle"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="display-row-copy">
        <span className="display-row-title">{label}</span>
        {description ? <span className="display-row-desc">{description}</span> : null}
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
  hint?: string
  options: { value: T; label: string; description: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <section className="display-settings-section">
      <div className="display-section-head">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      <SegmentedControl label={title} value={String(value)}
        options={options.map((option) => ({ value: String(option.value), label: option.label,
          wrap: (button) => <span key={option.value} title={option.description}>{button}</span>,
        }))}
        onChange={(next) => { const option = options.find((item) => String(item.value) === next); if (option) onChange(option.value) }} />
      {title === '默认排序' ? <p className="display-sort-direction">{options.find((option) => option.value === value)?.description}</p> : null}

    </section>
  )
}
