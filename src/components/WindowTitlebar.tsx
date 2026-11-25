import { useCallback, useEffect, useRef, type ReactElement, type Ref } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Database, Layers, Search, Settings2, Trash2, type AppIcon } from '@/icons/appIcons'
import { BacktestNavIcon, JournalNavIcon, NoteNavIcon } from '@/icons/NavigationIcons'
import { ICON_MD } from '@/icons/iconSize'
import { PanelToggleIcon } from '@/icons/StateIcons'
import { UNTITLED_QUICK_NOTE } from '@/data/quickNotes'
import { PRIMARY_NAV } from '@/lib/sidebarNav'
import { findSettingsSection } from '@/lib/settingsNav'
import { findTradeByRouteParam } from '@/lib/tradeRoute'
import { isValidPeriodSlug, PERIOD_LABELS } from '@/lib/periods'
import { savedViewMatchesLocation } from '@/lib/savedTradeViews'
import { getActiveWorkspaceView } from '@/lib/workspaceViews'
import { isReviewCaseScope, REVIEW_CASE_SCOPE_LABELS } from '@/lib/reviewCaseScope'
import { useStore } from '@/store/useStore'
import { registerShortcutHandlers } from '@/shortcuts/engine'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { ShortcutTooltip } from './ShortcutTooltip'
import { WORKSPACE_SIDEBAR_ID } from './ui/AppFrame'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { Button } from './ui/Button'
import { OverflowTooltip, Tooltip } from './ui/Tooltip'
import './WindowTitlebar.css'

const sectionIcons: Record<string, AppIcon | undefined> = {
  board: JournalNavIcon, trade: JournalNavIcon, period: JournalNavIcon, strategy: JournalNavIcon,
  notes: NoteNavIcon, backtests: BacktestNavIcon, settings: Settings2, 'trade-trash': Trash2, 'import-data-health': Database,
}

function WindowActionHint({ actionId, label, children }: { actionId: string; label: string; children: ReactElement }) {
  const { hint } = useShortcutHint(actionId, label)
  return hint
    ? <ShortcutTooltip actionId={actionId} label={label}>{children}</ShortcutTooltip>
    : <Tooltip asChild label={label} content={label}>{children}</Tooltip>
}

function useWindowLocation() {
  const { pathname, search } = useLocation()
  const { section, item } = useMatch('/:section/:item?/*')?.params ?? {}
  const page = PRIMARY_NAV.find(entry => entry.to === '/' + section)
  const settingsSection = section === 'settings' ? findSettingsSection(pathname) : undefined
  const journal = section === 'list' || section === 'board'
  const label = useStore(state => {
    switch (section) {
      case 'trade': {
        const trade = findTradeByRouteParam(state.trades, item)
        return trade ? [trade.symbol, trade.ref].filter(Boolean).join(' · ') : '交易详情'
      }
      case 'list':
      case 'board': return '交易日志'
      case 'review-cases': {
        const params = new URLSearchParams(search)
        const saved = state.savedTradeViews.find(view => view.pinned && savedViewMatchesLocation(view, pathname, search))
        if (saved) return saved.name
        const strategy = params.get('strategyId')
        const strategyName = strategy && state.strategies.find(s => s.id === strategy)?.name
        if (strategyName) return strategyName
        if (item && item !== 'all' && isReviewCaseScope(item)) return REVIEW_CASE_SCOPE_LABELS[item]
        const active = getActiveWorkspaceView('case', pathname, search, state.display.sidebarWorkspaceItems)
        if (active && active.id !== 'all') return active.label
        if (pathname.endsWith('/board')) return '案例看板'
        return active ? '全部案例' : '案例库'
      }
      case 'notes':
        return item ? state.quickNotes.find(note => note.id === item)?.title || UNTITLED_QUICK_NOTE : '随记'
      case 'backtests':
        return state.backtestProjects.find(project => project.id === item)?.name ?? '回测项目'
      case 'settings':
        if (pathname === '/settings/risk/data-repair') return '风险数据修复'
        if (pathname === '/settings/data/stage-ownership-repair') return '待归属记录'
        return settingsSection?.label ?? '设置'
      case 'period':
        return item && isValidPeriodSlug(item) ? PERIOD_LABELS[item] : '交易日志'
      case 'strategy':
        return state.strategies.find(strategy => strategy.id === item)?.name ?? '策略'
      case 'import-data-health': return '导入数据健康'
      case 'trade-trash': return '回收站'
      default: return page?.label ?? ''
    }
  })
  return {
    label,
    journal,
    recordRoute: section === 'trade',
    moduleRoot: !item && (journal || !!page || section === 'notes' || section === 'backtests'),
    Icon: settingsSection?.icon ?? page?.icon ?? sectionIcons[section ?? ''] ?? Layers,
  }
}

export function WindowTitlebar({ onOpenSearch, searchOpen, sidebarCollapsed, detailToolbarRef }: {
  detailToolbarRef?: Ref<HTMLDivElement>
  onOpenSearch: (trigger: HTMLElement) => void
  searchOpen: boolean
  sidebarCollapsed: boolean
}) {
  const navigate = useNavigate()
  const { label, Icon, journal, moduleRoot, recordRoute } = useWindowLocation()
  const title = label || 'Trader Atlas'
  const sidebarLabel = sidebarCollapsed ? '展开左侧导航' : '折叠左侧导航'
  const sidebarToggle = useRef<HTMLButtonElement>(null)
  const toggleSidebar = useCallback(() => {
    const { display, setDisplay } = useStore.getState()
    if (document.getElementById(WORKSPACE_SIDEBAR_ID)?.contains(document.activeElement)) {
      sidebarToggle.current?.focus({ preventScroll: true })
    }
    setDisplay({ sidebarCollapsed: !display.sidebarCollapsed })
  }, [])
  useEffect(() => registerShortcutHandlers({ 'global.toggleSidebar': toggleSidebar }), [toggleSidebar])
  // Chromium exposes the actual session history, including replace, traversal and reload.
  const history = (window as Window & { navigation?: { canGoBack: boolean; canGoForward: boolean } }).navigation
  useEffect(() => {
    document.title = label ? `${label} — Trader Atlas` : 'Trader Atlas'
    return () => { document.title = 'Trader Atlas' }
  }, [label])

  return (
    <header className="window-titlebar" aria-label="窗口工具栏">
      <div className="window-navigation">
        <WindowActionHint actionId="global.toggleSidebar" label={sidebarLabel}>
          <Button ref={sidebarToggle} size="sm" aria-label={sidebarLabel} aria-controls={WORKSPACE_SIDEBAR_ID} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>
            <PanelToggleIcon side="left" expanded={!sidebarCollapsed} size={ICON_MD} />
          </Button>
        </WindowActionHint>
        <nav className="window-history" aria-label="浏览历史">
          <Tooltip asChild content="后退" label="后退">
            <Button size="sm" aria-label="后退" disabled={!history?.canGoBack} onClick={() => navigate(-1)}>
              <ChevronLeft size={ICON_MD} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip asChild content="前进" label="前进">
            <Button size="sm" aria-label="前进" disabled={!history?.canGoForward} onClick={() => navigate(1)}>
              <ChevronRight size={ICON_MD} aria-hidden />
            </Button>
          </Tooltip>
        </nav>
      </div>
      {recordRoute && detailToolbarRef ? (
        <div className="window-detail-tools" ref={detailToolbarRef} />
      ) : (
        <div className="window-context">
          <div className="window-location" aria-current="page">
            {(sidebarCollapsed || !moduleRoot) && <Icon className="window-location-icon" size={ICON_MD} aria-hidden />}
            {journal
              ? <h1 className="window-location-label">{title}</h1>
              : <OverflowTooltip text={title}><span className="window-location-label">{title}</span></OverflowTooltip>}
          </div>
          {journal && <SaveStatusIndicator />}
        </div>
      )}
      <WindowActionHint actionId="global.commandPalette" label="搜索与命令">
        <Button className="window-search" size="sm" data-command-palette-trigger
          aria-label="搜索与命令" aria-haspopup="dialog" aria-expanded={searchOpen}
          onClick={event => onOpenSearch(event.currentTarget)}>
          <Search size={ICON_MD} aria-hidden />
        </Button>
      </WindowActionHint>
    </header>
  )
}
