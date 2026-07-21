import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
import { RotateCcw, X } from '@/icons/appIcons'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import {
  CASE_TYPE_META,
  MASTERY_STATE_META,
  REVIEW_CATEGORY_META,
  STATUS_META,
  type CaseType,
  type MasteryState,
  type ReviewCategory,
  type Trade,
  type TradeSide,
  type TradeStatus,
} from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { PERIOD_LABELS } from '@/lib/periods'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { getStrategyName } from '@/lib/strategies'
import { collectSymbolOptions } from '@/lib/symbolIcons'
import { collectMistakeTagOptions, collectTagOptions } from '@/lib/tags'
import { routeWithSearch } from '@/lib/tradeView'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import { clampPopoverLeft } from '@/lib/popoverPosition'
import {
  canonicalizeTradeViewSearch,
  normalizeSavedViewPath,
  savedViewMatchesLocation,
} from '@/lib/savedTradeViews'
import { getActiveWorkspaceView, type WorkspaceKind } from '@/lib/workspaceViews'
import { FilterBar, type ActiveFilter } from '@/components/ui/FilterBar'
import { QuickViewBar } from '@/components/trades/QuickViewBar'
import { SymbolIcon } from '@/components/SymbolIcon'
import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import './TradeFilters.css'

const KNOWN_TRADE_VIEW_PARAMS = new Set([
  'tradeKind',
  'period',
  'strategyId',
  'symbol',
  'side',
  'status',
  'session',
  'tag',
  'mistakeTag',
  'reviewCategory',
  'caseType',
  'masteryState',
  'kind',
  'range',
])

export function TradeFilters({
  filter,
  trades,
  strategies,
}: {
  filter: ListFilter
  trades: Trade[]
  strategies: Strategy[]
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const savedViews = useStore((state) => state.savedTradeViews)
  const symbolCatalog = useStore((state) => state.symbolCatalog)
  const symbolIcons = useStore((state) => state.symbolIcons)
  const tagPresets = useStore((state) => state.tagPresets)
  const mistakeTagPresets = useStore((state) => state.mistakeTagPresets)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 8, maxHeight: 480 })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelExitRef = useExitClone<HTMLDivElement>(open)
  const panelId = 'trade-filter-panel'
  const assignPanelRef = (node: HTMLDivElement | null) => {
    panelRef.current = node
    panelExitRef(node)
  }
  const workspaceKind: WorkspaceKind = filter.tradeKind === 'case'
    ? 'case'
    : filter.tradeKind === 'paper'
      ? 'paper'
      : 'trade'
  const isCaseWorkspace = workspaceKind === 'case'
  const isPaperWorkspace = workspaceKind === 'paper'
  const usesQueryScope = isCaseWorkspace || isPaperWorkspace
  const allowsTradeKindFacet = !filter.tradeKind && (
    !filter.analysisScope || filter.analysisScope.kind === 'all'
  )
  const filterLabel = isCaseWorkspace
    ? '筛选案例'
    : isPaperWorkspace
      ? '筛选模拟交易'
      : '筛选交易'
  const filterDialogLabel = isCaseWorkspace
    ? '案例筛选'
    : isPaperWorkspace
      ? '模拟交易筛选'
      : '交易筛选'
  const symbols = useMemo(
    () => collectSymbolOptions(symbolCatalog, trades.map((trade) => trade.symbol)),
    [symbolCatalog, trades],
  )
  const tags = useMemo(
    () => collectTagOptions(tagPresets, trades),
    [tagPresets, trades],
  )
  const mistakeTags = useMemo(
    () => collectMistakeTagOptions(mistakeTagPresets, trades),
    [mistakeTagPresets, trades],
  )

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const current = searchParams.toString()
    const canonical = canonicalizeTradeViewSearch(searchParams)
    if (!allowsTradeKindFacet) canonical.delete('tradeKind')
    if (canonical.toString() !== current) setSearchParams(canonical, { replace: true })
  }, [allowsTradeKindFacet, searchParams, setSearchParams])

  const activeFilters: ActiveFilter[] = []
  const quickPeriod = ['/period/this-week', '/period/this-month'].includes(
    normalizeSavedViewPath(location.pathname),
  )
  if (filter.type === 'period' && filter.period && !quickPeriod) {
    activeFilters.push({ key: 'period', label: PERIOD_LABELS[filter.period] })
  } else if (filter.type === 'strategy') {
    activeFilters.push({ key: 'strategy-route', label: getStrategyName(strategies, filter.strategyId) })
  } else if (filter.type === 'active') {
    activeFilters.push({ key: 'active-route', label: '进行中' })
  } else if (filter.type === 'starred') {
    activeFilters.push({ key: 'starred-route', label: '星标交易' })
  } else if (filter.type === 'missed') {
    activeFilters.push({ key: 'missed-route', label: '错过的机会' })
  }
  if (filter.tradeKind === 'paper') activeFilters.push({ key: 'kind-route', label: '模拟' })
  if (filter.tradeKind === 'case' && !location.pathname.startsWith('/review-cases')) {
    activeFilters.push({ key: 'kind-route', label: '案例记录' })
  }

  const facetLabels: Array<[string, string]> = [
    [
      'tradeKind',
      allowsTradeKindFacet
        ? searchParams.get('tradeKind') === 'live'
          ? '实盘'
          : searchParams.get('tradeKind') === 'paper'
            ? '模拟'
            : ''
        : '',
    ],
    [
      'period',
      searchParams.get('period')
        ? PERIOD_LABELS[searchParams.get('period') as keyof typeof PERIOD_LABELS] ?? ''
        : '',
    ],
    [
      'strategyId',
      searchParams.get('strategyId')
        ? getStrategyName(strategies, searchParams.get('strategyId') ?? '')
        : '',
    ],
    ['symbol', searchParams.get('symbol') ?? ''],
    ['side', searchParams.get('side') === 'long' ? '做多' : searchParams.get('side') === 'short' ? '做空' : ''],
    ['status', searchParams.get('status') ? STATUS_META[searchParams.get('status') as TradeStatus]?.label ?? '' : ''],
    [
      'session',
      searchParams.get('session') === 'london'
        ? '伦敦盘'
        : searchParams.get('session') === 'new-york'
          ? '纽约盘'
          : searchParams.get('session') === 'asia'
            ? '亚盘'
            : searchParams.get('session') === 'outside'
              ? '盘外时段'
              : searchParams.get('session') === 'other'
                ? '其他时段'
                : '',
    ],
    ['tag', searchParams.get('tag') ?? ''],
    ['mistakeTag', searchParams.get('mistakeTag') ?? ''],
    [
      'reviewCategory',
      searchParams.get('reviewCategory')
        ? REVIEW_CATEGORY_META[searchParams.get('reviewCategory') as ReviewCategory]?.label ?? ''
        : '',
    ],
    [
      'caseType',
      searchParams.get('caseType')
        ? CASE_TYPE_META[searchParams.get('caseType') as CaseType]?.label ?? ''
        : '',
    ],
    [
      'masteryState',
      searchParams.get('masteryState')
        ? MASTERY_STATE_META[searchParams.get('masteryState') as MasteryState]?.label ?? ''
        : '',
    ],
  ]
  const activeWorkspaceView = getActiveWorkspaceView(
    workspaceKind,
    location.pathname,
    location.search,
  )
  const baselineParams = new URLSearchParams(activeWorkspaceView?.search ?? '')
  for (const [key, label] of facetLabels) {
    if (label && baselineParams.get(key) !== searchParams.get(key)) {
      activeFilters.push({ key, label, onRemove: () => setParam(key, '') })
    }
  }
  for (const [key, value] of searchParams) {
    if (KNOWN_TRADE_VIEW_PARAMS.has(key)) continue
    activeFilters.push({
      key: `unsupported:${key}:${value}`,
      label: `未支持的筛选条件，可移除`,
      onRemove: () => setParam(key, ''),
    })
  }
  const searchText = searchParams.toString()
  const currentSavedView = savedViews.some((view) =>
    savedViewMatchesLocation(view, location.pathname, searchText),
  )
  const visibleActiveFilters = currentSavedView
    ? activeFilters.filter((item) => item.key.startsWith('unsupported:'))
    : activeFilters

  const go = (path: string) => {
    const mode = workbenchModeFromPathname(location.pathname)
    navigate(routeWithSearch(pathWithWorkbenchMode(path, mode), searchParams.toString()))
  }

  const resetFilters = () => {
    const base =
      filter.tradeKind === 'paper' ? '/sim' : filter.tradeKind === 'case' ? '/review-cases' : '/list'
    const mode = workbenchModeFromPathname(location.pathname)
    navigate(pathWithWorkbenchMode(base, mode), { replace: true })
  }

  const closeFilters = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const toggleFilters = useCallback(() => {
    setOpen((current) => {
      if (current) requestAnimationFrame(() => triggerRef.current?.focus())
      return !current
    })
  }, [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const edge = 8
      const top = rect.bottom + 4
      const width = Math.min(420, window.innerWidth - edge * 2)
      setPanelPos({
        top,
        left: clampPopoverLeft(rect.right - width, width, window.innerWidth, edge),
        maxHeight: Math.max(200, window.innerHeight - top - edge),
      })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open])

  useEffect(() => {
    const toggleFromShortcut = () => toggleFilters()
    window.addEventListener('atlas:toggle-trade-filters', toggleFromShortcut)
    return () => window.removeEventListener('atlas:toggle-trade-filters', toggleFromShortcut)
  }, [toggleFilters])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus()

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.ui-select-menu')) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeFilters()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeFilters, open])

  const panel = open
    ? createPortal(
        <div
          className="trade-filter-panel"
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={filterDialogLabel}
          ref={assignPanelRef}
          style={{
            top: panelPos.top,
            left: panelPos.left,
            maxHeight: panelPos.maxHeight,
          }}
        >
          <div className="trade-filter-head">
            <strong>{filterLabel}</strong>
            <div className="trade-filter-head-actions">
              <Tooltip content="清除全部条件" label="清除全部条件">
                <button type="button" onClick={resetFilters} aria-label="清除全部条件">
                  <RotateCcw size={14} />
                </button>
              </Tooltip>
              <Tooltip content="关闭" label="关闭筛选器">
                <button
                  type="button"
                  onClick={closeFilters}
                  aria-label="关闭筛选器"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="trade-filter-body">
            <section className="trade-filter-section">
              <h3>范围</h3>
              <div className="trade-filter-scope-grid">
                <FilterSelect
                  label={isCaseWorkspace ? '来源日期' : '时间'}
                  value={
                    usesQueryScope
                      ? searchParams.get('period') ?? ''
                      : filter.type === 'period'
                        ? filter.period ?? ''
                        : ''
                  }
                  onChange={(value) => {
                    if (usesQueryScope) setParam('period', value)
                    else if (value === 'today') go('/period/today')
                    else if (value) go(`/period/${value}`)
                    else go('/list')
                  }}
                  options={[
                    ['', '全部时间'],
                    ['today', '今日'],
                    ['this-week', '本周'],
                    ['last-week', '上周'],
                    ['this-month', '本月'],
                    ['last-month', '上月'],
                  ]}
                />
                <FilterSelect
                  label="策略"
                  value={
                    usesQueryScope
                      ? searchParams.get('strategyId') ?? ''
                      : filter.type === 'strategy'
                        ? filter.strategyId ?? ''
                        : ''
                  }
                  onChange={(value) =>
                    usesQueryScope
                      ? setParam('strategyId', value)
                      : value
                        ? go(`/strategy/${value}`)
                        : go('/list')
                  }
                  options={[['', '全部策略'], ...strategies.map((item) => [item.id, item.name] as [string, string])]}
                />
              </div>
            </section>

            <div className="trade-filter-columns">
              <section className="trade-filter-section">
                <h3>{isCaseWorkspace ? '案例条件' : '交易条件'}</h3>
                <div className="trade-filter-condition-grid">
                  {isCaseWorkspace ? (
                    <>
                      <FilterSelect
                        label="案例类型"
                        value={searchParams.get('caseType') ?? ''}
                        onChange={(value) => setParam('caseType', value)}
                        options={[
                          ['', '全部类型'],
                          ...(Object.keys(CASE_TYPE_META) as CaseType[]).map(
                            (value) => [value, CASE_TYPE_META[value].label] as [string, string],
                          ),
                        ]}
                      />
                      <FilterSelect
                        label="掌握状态"
                        value={searchParams.get('masteryState') ?? ''}
                        onChange={(value) => setParam('masteryState', value)}
                        options={[
                          ['', '全部状态'],
                          ...(Object.keys(MASTERY_STATE_META) as MasteryState[]).map(
                            (value) => [value, MASTERY_STATE_META[value].label] as [string, string],
                          ),
                        ]}
                      />
                      <FilterSelect
                        label="复盘分类"
                        value={searchParams.get('reviewCategory') ?? ''}
                        onChange={(value) => setParam('reviewCategory', value)}
                        options={[
                          ['', '全部分类'],
                          ...(Object.keys(REVIEW_CATEGORY_META) as ReviewCategory[]).map(
                            (value) => [value, REVIEW_CATEGORY_META[value].label] as [string, string],
                          ),
                        ]}
                      />
                      <FilterSelect
                        label="品种"
                        value={searchParams.get('symbol') ?? ''}
                        onChange={(value) => setParam('symbol', value)}
                        options={[
                          { value: '', label: '全部品种' },
                          ...symbols.map((value) => ({
                            value,
                            label: value,
                            icon: <SymbolIcon symbol={value} overrides={symbolIcons} size={14} />,
                          })),
                        ]}
                      />
                    </>
                  ) : (
                    <>
                      {allowsTradeKindFacet ? (
                        <FilterSelect
                          label="记录类型"
                          value={searchParams.get('tradeKind') ?? ''}
                          onChange={(value) => setParam('tradeKind', value)}
                          options={[
                            ['', '全部记录'],
                            ['live', '实盘'],
                            ['paper', '模拟'],
                          ] satisfies Array<[string, string]>}
                        />
                      ) : null}
                      <FilterSelect
                        label="状态"
                        value={searchParams.get('status') ?? ''}
                        onChange={(value) => setParam('status', value)}
                        options={[['', '全部状态'], ...STATUS_ORDER.map((value) => [value, STATUS_META[value].label] as [string, string])]}
                      />
                      <FilterSelect
                        label="品种"
                        value={searchParams.get('symbol') ?? ''}
                        onChange={(value) => setParam('symbol', value)}
                        options={[
                          { value: '', label: '全部品种' },
                          ...symbols.map((value) => ({
                            value,
                            label: value,
                            icon: <SymbolIcon symbol={value} overrides={symbolIcons} size={14} />,
                          })),
                        ]}
                      />
                      <FilterSelect
                        label="方向"
                        value={searchParams.get('side') ?? ''}
                        onChange={(value) => setParam('side', value)}
                        options={[
                          ['', '全部方向'],
                          ['long', '做多'],
                          ['short', '做空'],
                        ]}
                      />
                      <FilterSelect
                        label="交易时段"
                        value={searchParams.get('session') ?? ''}
                        onChange={(value) => setParam('session', value)}
                        options={[
                          ['', '全部时段'],
                          ['london', '伦敦盘'],
                          ['new-york', '纽约盘'],
                          ['asia', '亚盘'],
                          ['outside', '盘外时段'],
                          ['other', '其他时段'],
                        ]}
                      />
                    </>
                  )}
                </div>
              </section>

              <section className="trade-filter-section">
                <h3>复盘信息</h3>
                <div className="trade-filter-condition-grid">
                  <FilterSelect
                    label="标签"
                    value={searchParams.get('tag') ?? ''}
                    onChange={(value) => setParam('tag', value)}
                    options={[['', '全部标签'], ...tags.map((value) => [value, value] as [string, string])]}
                  />
                  <FilterSelect
                    label="错误标签"
                    value={searchParams.get('mistakeTag') ?? ''}
                    onChange={(value) => setParam('mistakeTag', value)}
                    options={[['', '全部错误'], ...mistakeTags.map((value) => [value, value] as [string, string])]}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <FilterBar
        activeFilters={visibleActiveFilters}
        open={open}
        onToggle={toggleFilters}
        rootRef={rootRef}
        triggerRef={triggerRef}
        panelId={panelId}
        label={filterLabel}
        shortcutActionId="list.toggleFilters"
        quickViews={<QuickViewBar kind={workspaceKind} />}
      />
      {panel}
    </>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string] | { value: string; label: string; icon?: ReactNode }>
}) {
  return (
    <div className="trade-filter-field">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={onChange}
        ariaLabel={label}
        options={options.map((option) =>
          Array.isArray(option)
            ? { value: option[0], label: option[1] }
            : option,
        )}
      />
    </div>
  )
}
