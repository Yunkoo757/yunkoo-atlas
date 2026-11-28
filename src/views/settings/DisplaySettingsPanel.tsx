import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import { TRADING_DAY_START_HOUR_OPTIONS } from '@/lib/periods'
import {
  WINDOW_SIZE_PRESETS,
  type WindowSizePresetId,
} from '@/lib/windowBounds'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { AutoLaunchState, WindowFrameState, WindowsClosePreference } from '@/types/journalBridge'
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
  { value: 'compact', label: '紧凑', description: '同屏显示更多记录' },
  { value: 'comfortable', label: '舒展', description: '增加行间留白' },
]

const WINDOWS_CLOSE_OPTIONS: {
  value: WindowsClosePreference
  label: string
  description: string
}[] = [
  { value: 'ask', label: '每次询问', description: '关闭时选择隐藏或退出' },
  { value: 'tray', label: '隐藏窗口', description: '保持后台运行并保留当前页面' },
  { value: 'quit', label: '彻底退出', description: '保存完成后退出应用' },
]

export function DisplaySettingsPanel() {
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const electron = isElectron()
  const bridge = getJournalBridge()
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
    if (!electron || !bridge) return
    let cancelled = false
    void bridge.getWindowsClosePreference().then((preference) => {
      if (!cancelled) setWindowsClosePreference(preference)
    })
    return () => { cancelled = true }
  }, [bridge, electron])

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
      if (state.error) toast(state.error, { tone: 'error', persistent: false })
      else toast(enabled ? '已开启开机自动启动' : '已关闭开机自动启动', { tone: 'success' })
    } catch {
      toast('开机启动设置失败，请重试', { tone: 'error', persistent: false })
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
      : `当前 ${windowState.width} × ${windowState.height}`
    : ''

  const applyWindowsClosePreference = async (preference: WindowsClosePreference) => {
    if (!bridge) return
    const saved = await bridge.setWindowsClosePreference(preference)
    setWindowsClosePreference(saved)
  }

  const activeTradingDayOption = TRADING_DAY_OPTS.find(
    (option) => option.value === display.tradingDayStartHour,
  )
  const sortOptions = getSortOptions(display.sortBy, display.sortDirection)
  const activeSortDesc = sortOptions.find((option) => option.value === display.sortBy)?.description
  const activeCloseDesc = WINDOWS_CLOSE_OPTIONS.find(
    (option) => option.value === windowsClosePreference,
  )?.description

  return (
    <div className="settings-page settings-page--form display-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">显示</h1>
      </div>

      <section className="settings-group" aria-labelledby="display-list-group">
        <div className="settings-group-head display-section-head">
          <h2 id="display-list-group" className="settings-section-title">交易列表</h2>
        </div>
        <div className="settings-card display-settings-card">
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
          <ChoiceRow
            title="列表密度"
            options={LIST_DENSITY_OPTS}
            value={display.listRowDensity}
            onChange={(value) => setDisplay({ listRowDensity: value })}
          />
          <ChoiceRow
            title="分组方式"
            options={GROUP_OPTS}
            value={groupMode}
            onChange={setGroupMode}
          />
          <ChoiceRow
            title="默认排序"
            description={activeSortDesc}
            options={sortOptions}
            value={display.sortBy}
            onChange={(value) => {
              setDisplay({
                sortBy: value,
                sortDirection: value === display.sortBy ? display.sortDirection : 'desc',
                ...(value === 'date' ? {} : { groupByDate: false, groupByStrategy: false }),
              })
            }}
          />
          <ChoiceRow
            title="排序方向"
            options={[
              { value: 'asc', label: '升序', description: '从低到高' },
              { value: 'desc', label: '降序', description: '从高到低' },
            ]}
            value={display.sortDirection}
            onChange={(sortDirection) => setDisplay({ sortDirection })}
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="display-time-group">
        <div className="settings-group-head display-section-head">
          <h2 id="display-time-group" className="settings-section-title">交易日口径</h2>
        </div>
        <div className="settings-card display-settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">交易日开始于</span>
              <span className="settings-row-desc">
                {activeTradingDayOption ? `${activeTradingDayOption.description} · ` : ''}该时刻前计入前一交易日
              </span>
            </div>
            <div className="settings-row-control">
              <Select
                className="display-trading-day-select"
                ariaLabel="交易日开始于"
                value={String(display.tradingDayStartHour)}
                options={TRADING_DAY_OPTS.map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
                onValueChange={(next) => {
                  const option = TRADING_DAY_OPTS.find((item) => String(item.value) === next)
                  if (option) setDisplay({ tradingDayStartHour: option.value })
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {electron ? (
        <section className="settings-group" aria-labelledby="display-desktop-group">
          <div className="settings-group-head display-section-head">
            <h2 id="display-desktop-group" className="settings-section-title">桌面窗口</h2>
          </div>
          <div className="settings-card display-settings-card">
            <div className="display-auto-launch-row" data-auto-launch-setting>
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
                    className="ui-btn ui-btn-bordered ui-btn-sm"
                    disabled={autoLaunchBusy}
                    onClick={() => void loadAutoLaunchState()}
                  >
                    重试读取
                  </button>
                </div>
              ) : null}
            </div>

            <div className="settings-row display-window-preset-row">
              <div className="settings-row-copy">
                <span className="settings-row-title">主窗口尺寸</span>
                {currentSizeLabel ? <span className="settings-row-desc">{currentSizeLabel}</span> : null}
              </div>
              <div className="display-preset-pills" role="radiogroup" aria-label="主窗口尺寸预置">
                {WINDOW_SIZE_PRESETS.map((preset) => {
                  const selected = windowState?.presetId === preset.id
                  return (
                    <label key={preset.id} className={'display-preset-pill' + (selected ? ' is-selected' : '')}>
                      <input
                        type="radio"
                        name="window-size-preset"
                        value={preset.id}
                        checked={selected}
                        aria-label={preset.label}
                        onChange={() => void applyWindowPreset(preset.id)}
                      />
                      <span>{preset.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {windowMessage ? (
              <p className="display-settings-hint" role="status">
                {windowMessage}
              </p>
            ) : null}

            <ToggleRow
              label="锁定窗口大小"
              description="尺寸预置仍可使用"
              checked={windowState?.resizable === false}
              onChange={(locked) => void applyWindowResizeLock(locked)}
            />

            <ChoiceRow
              title="关闭主窗口"
              description={activeCloseDesc}
              options={WINDOWS_CLOSE_OPTIONS}
              value={windowsClosePreference}
              onChange={(preference) => void applyWindowsClosePreference(preference)}
            />
          </div>
        </section>
      ) : null}
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
      className="settings-row display-toggle"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-row-copy display-row-copy">
        <span className="settings-row-title display-row-title">{label}</span>
        {description ? <span className="settings-row-desc display-row-desc">{description}</span> : null}
      </span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}

function ChoiceRow<T extends string | number>({
  title,
  description,
  options,
  value,
  onChange,
}: {
  title: string
  description?: string
  options: { value: T; label: string; description: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="settings-row display-choice-row">
      <div className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {description ? <span className="settings-row-desc">{description}</span> : null}
      </div>
      <div className="settings-row-control">
        <SegmentedControl
          label={title}
          value={String(value)}
          options={options.map((option) => ({ value: String(option.value), label: option.label }))}
          onChange={(next) => {
            const option = options.find((item) => String(item.value) === next)
            if (option) onChange(option.value)
          }}
        />
      </div>
    </div>
  )
}
