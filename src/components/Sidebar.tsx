import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { AppIcon } from '@/icons/appIcons'
import {
  ChevronDown,
  Ban,
  BookOpen,
  Bookmark,
  Clock,
  Compose,
  FlaskConical,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Star,
  Target,
  Trash2,
} from '@/icons/appIcons'
import { UserAvatar } from '@/components/UserAvatar'
import { StrategyIcon } from '@/components/StrategyIcon'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
import { Menu } from '@/components/Menu'
import { ContextMenu, type CtxItem, type CtxState } from '@/components/ContextMenu'
import {
  normalizePrimarySidebarOrder,
  resolvePrimarySidebarNav,
  type PrimarySidebarNavId,
} from '@/lib/sidebarNav'
import {
  SIDEBAR_CAPABILITY_WORKSPACES,
  SIDEBAR_QUICK_WORKSPACE_LABELS,
  isCapabilityEnabledForWorkspace,
  isSidebarNavigationTarget,
  isSidebarCapabilityId,
  resolveCapabilityRoute,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  setCapabilityWorkspaceEnabled,
  systemCapabilityWorkspaces,
  workspaceKindFromPath,
  type ResolvedSidebarWorkspaceItem,
  type SidebarCapabilityId,
  type SidebarQuickWorkspace,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { resolveWorkspaceNavTarget, workspaceRouteHref } from '@/lib/workspaceViews'
import { sharedTradeWorkspaceSearch, tradeHomeSearch } from '@/lib/tradeWorkspaceQuery'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import {
  SIDEBAR_WORKSPACE_EDITOR_ID,
  SidebarWorkspaceEditor,
} from '@/components/sidebar/SidebarWorkspaceEditor'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useExitClone } from '@/components/ui/useExitClone'
import { SidebarRiskStatus } from '@/components/SidebarRiskStatus'
import { SIDEBAR_STRATEGY_SHORTCUT_LIMIT } from '@/shortcuts/workspaceActions'

import './Sidebar.css'
import './sidebar/SidebarWorkspace.css'

type SidebarDensity = 'standard' | 'compact'

function currentSidebarDensity(): SidebarDensity {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'standard'
  return window.matchMedia('(max-width: 1099px)').matches ? 'compact' : 'standard'
}

function useSidebarDensity(): SidebarDensity {
  const [density, setDensity] = useState<SidebarDensity>(currentSidebarDensity)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1099px)')
    const update = () => setDensity(query.matches ? 'compact' : 'standard')
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return density
}

function buildCapabilityVisibilityItems(
  capabilityId: SidebarCapabilityId,
  label: string,
  items: SidebarWorkspaceItem[],
  onToggle: (
    capabilityId: SidebarCapabilityId,
    workspace: SidebarQuickWorkspace,
    enabled: boolean,
    label: string,
  ) => void,
): CtxItem[] {
  const scopeLabel = capabilityId === 'missed' ? '包含范围' : '可见工作区'
  const existing = items.find(
    (item) => item.target.kind === 'system' && item.target.id === capabilityId,
  )
  const enabled = new Set(
    existing && existing.target.kind === 'system'
      ? systemCapabilityWorkspaces(existing.target)
      : [],
  )
  return [
    { type: 'label', text: scopeLabel },
    ...SIDEBAR_CAPABILITY_WORKSPACES[capabilityId].flatMap((workspace) => {
      if (!resolveCapabilityRoute(capabilityId, workspace)) return []
      const checked = enabled.has(workspace)
      return [
        {
          type: 'item' as const,
          label: SIDEBAR_QUICK_WORKSPACE_LABELS[workspace],
          checked,
          keepOpen: true,
          onClick: () => onToggle(capabilityId, workspace, !checked, label),
        },
      ]
    }),
  ]
}

export const WORKSPACE_ICONS: Record<
  ResolvedSidebarWorkspaceItem['icon'],
  AppIcon
> = {
  active: Clock,
  favorites: Star,
  missed: Ban,
  paper: FlaskConical,
  'saved-view': Bookmark,
  strategy: Target,
  'case-view': BookOpen,
}

function activeIconStyle(color: string): CSSProperties {
  return { '--sb-active-icon-color': color } as CSSProperties
}

export function useSidebarNavigationModel() {
  const navigate = useNavigate()
  const { pathname: path, search } = useLocation()
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const display = useStore((state) => state.display)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const savedTradeViews = useStore((state) => state.savedTradeViews)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
  const workspaceMemory = display.workspaceMemory
  const tradeTarget = resolveWorkspaceNavTarget('trade', workspaceMemory?.trade, strategies)
  const usesCurrentTradeContext = (
    path === '/list'
    || path === '/board'
    || path === '/active'
    || path === '/dashboard'
    || path === '/weekly-review'
    || path.startsWith('/period/')
    || path.startsWith('/strategy/')
  )
  const stageContextSearch = usesCurrentTradeContext ? search : tradeTarget.search
  const workspaceLiveStage = new URLSearchParams(stageContextSearch).get('liveStage')

  const workspaceItems = useMemo(
    () => sidebarWorkspaceItems
      .filter((item) => isSidebarNavigationTarget(item.target))
      .map((item) => resolveSidebarWorkspaceItem(
        item,
        { savedViews: savedTradeViews, strategies },
        path,
      ))
      .filter((item) => !item.invalid)
      .filter((item) => {
        const target = item.item.target
        if (target.kind === 'system' && isSidebarCapabilityId(target.id)) {
          if (target.id === 'missed') return true
          return isCapabilityEnabledForWorkspace(
            [item.item],
            target.id,
            workspaceKindFromPath(path),
          )
        }
        return true
      })
      .map((item) => {
        const inheritsLiveStage = item.item.target.kind === 'strategy'
          || item.item.target.kind === 'system'
        if (!inheritsLiveStage || !workspaceLiveStage) {
          return item
        }
        const params = new URLSearchParams(item.search)
        params.set('liveStage', workspaceLiveStage)
        const scoped = { ...item, search: `?${params.toString()}` }
        return scoped
      }),
    [
      path,
      savedTradeViews,
      sidebarWorkspaceItems,
      workspaceLiveStage,
      strategies,
    ],
  )
  const selection = useMemo(
    () => resolveSidebarSelection({ pathname: path, search, items: workspaceItems }),
    [path, search, workspaceItems],
  )
  const todayTarget = { pathname: '/today-record', search: '' }
  const caseTarget = resolveWorkspaceNavTarget('case', workspaceMemory?.case)
  const tradeHomeTarget = {
    pathname: '/list',
    search: tradeHomeSearch(selection.activePrimaryId === 'trades' ? search : tradeTarget.search),
  }
  const primaryHref = (id: PrimarySidebarNavId, fallback: string) => {
    if (id === 'today') return workspaceRouteHref(todayTarget)
    if (id === 'trades') {
      return `${tradeHomeTarget.pathname}${tradeHomeTarget.search}`
    }
    if (id === 'reviewCases') return workspaceRouteHref(caseTarget)
    if (id === 'dashboard' || id === 'weeklyReview') {
      return `${fallback}${sharedTradeWorkspaceSearch(stageContextSearch)}`
    }
    return fallback
  }

  return {
    path,
    search,
    trades,
    strategies,
    sidebarWorkspaceItems,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    workspaceItems,
    selection,
    primaryHref,
  }
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const density = useSidebarDensity()
  const navigate = useNavigate()
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false)
  const [workspaceEditorSection, setWorkspaceEditorSection] = useState<'pinned' | 'overflow'>('pinned')
  const [capabilityMenu, setCapabilityMenu] = useState<(CtxState & { itemId: string }) | null>(null)
  const workspaceEditorOpener = useRef<HTMLButtonElement | null>(null)
  const workspaceEditorExitRef = useExitClone<HTMLDivElement>(workspaceEditorOpen)
  const openComposer = useStore((state) => state.openComposer)
  const storedPrimaryOrder = useStore((state) => state.display.sidebarPrimaryOrder)
  const primaryOrder = normalizePrimarySidebarOrder(storedPrimaryOrder)
  const setDisplay = useStore((state) => state.setDisplay)
  const profile = useStore((state) => state.profile)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const sidebarDateAnchor = useBusinessDateAnchor()
  const {
    path,
    search,
    trades,
    strategies,
    sidebarWorkspaceItems,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    workspaceItems,
    selection,
    primaryHref,
  } = useSidebarNavigationModel()
  const pinnedWorkspaceItems = workspaceItems
    .filter((item) => item.item.placement === 'pinned')
    .slice(0, 8)
  const overflowWorkspaceItems = workspaceItems.filter(
    (item) => item.item.placement === 'overflow',
  )
  const strategyShortcutActionByItemId = useMemo(
    () => new Map(
      workspaceItems
        .filter((item) => item.item.target.kind === 'strategy')
        .slice(0, SIDEBAR_STRATEGY_SHORTCUT_LIMIT)
        .map((item, index) => [item.item.id, `nav.strategySlot${index + 1}`]),
    ),
    [workspaceItems],
  )
  const primaryNav = useMemo(() => resolvePrimarySidebarNav(primaryOrder), [primaryOrder])

  const trashCount = trades.filter((trade) => Boolean(trade.deletedAt)).length
  const openWorkspaceEditor = (
    button: HTMLButtonElement,
    section: 'pinned' | 'overflow' = 'pinned',
  ) => {
    workspaceEditorOpener.current = button
    setWorkspaceEditorSection(section)
    setWorkspaceEditorOpen(true)
  }
  const closeWorkspaceEditor = () => {
    setWorkspaceEditorOpen(false)
    requestAnimationFrame(() => workspaceEditorOpener.current?.focus())
  }

  const renderWorkspaceLink = (item: (typeof workspaceItems)[number]) => {
    const Icon = WORKSPACE_ICONS[item.icon]
    const strategyTarget = item.item.target.kind === 'strategy' ? item.item.target : undefined
    const strategy = strategyTarget
      ? strategies.find((candidate) => candidate.id === strategyTarget.strategyId)
      : undefined
    const active = selection.activeWorkspaceItemId === item.item.id
    const modified = selection.modifiedWorkspaceItemId === item.item.id
    const capabilityId =
      item.item.target.kind === 'system' && isSidebarCapabilityId(item.item.target.id)
        ? item.item.target.id
        : null
    const capabilityMenuId = capabilityId === 'missed' ? null : capabilityId
    const capabilityMenuOpen = Boolean(capabilityMenuId && capabilityMenu?.itemId === item.item.id)
    const strategyShortcutActionId = strategyShortcutActionByItemId.get(item.item.id)

    const toggleCapabilityWorkspace = (
      id: SidebarCapabilityId,
      workspace: SidebarQuickWorkspace,
      enabled: boolean,
      label: string,
    ) => {
      const previous = useStore.getState().display.sidebarWorkspaceItems
      const next = setCapabilityWorkspaceEnabled(previous, id, workspace, enabled)
      if (id === 'missed' && !enabled && next === previous) {
        toast('至少保留一个包含来源')
        return
      }
      replaceSidebarWorkspaceItems(next)
      const stillPresent = next.some(
        (candidate) => candidate.target.kind === 'system' && candidate.target.id === id,
      )
      if (!stillPresent) {
        setCapabilityMenu(null)
        toast(`已从侧栏移除「${label}」`, {
          label: '撤销',
          onClick: () => replaceSidebarWorkspaceItems(previous),
        })
        return
      }
      setCapabilityMenu((current) =>
        current
          ? {
              ...current,
              items: buildCapabilityVisibilityItems(id, label, next, toggleCapabilityWorkspace),
            }
          : null,
      )
    }

    const openCapabilityMenu = (x: number, y: number, originElement?: HTMLElement | null) => {
      if (!capabilityMenuId) return
      setCapabilityMenu({
        itemId: item.item.id,
        x,
        y,
        originElement,
        items: buildCapabilityVisibilityItems(
          capabilityMenuId,
          item.label,
          useStore.getState().display.sidebarWorkspaceItems,
          toggleCapabilityWorkspace,
        ),
      })
    }

    const workspaceLink = (
      <NavLink
        to={workspaceRouteHref(item)}
        draggable={false}
        className="sb-item"
        data-ws-icon={item.icon}
        aria-current={active ? 'location' : undefined}
        onDragStart={(event) => event.preventDefault()}
      >
        {strategy ? (
          <StrategyIcon
            icon={strategy.icon}
            color={strategy.color}
            size={ICON_MD}
            variant="nav"
          />
        ) : (
          <Icon size={ICON_MD} />
        )}
        <span className="sb-item-label">{item.label}</span>
      </NavLink>
    )

    return (
      <div
        key={item.item.id}
        data-sidebar-workspace-id={item.item.id}
        data-sidebar-workspace-placement={item.item.placement}
        data-sidebar-capability={capabilityId ?? undefined}
        className={
          `sb-sortable-row${active ? ' is-active is-scope-active' : ''}${modified ? ' is-modified' : ''}${
            capabilityMenuOpen ? ' is-capability-menu-open' : ''
          }`
        }
        data-ws-icon={item.icon}
        style={activeIconStyle('var(--nav-active-icon)')}
        onContextMenu={(event) => {
          if (!capabilityMenuId) return
          event.preventDefault()
          openCapabilityMenu(event.clientX, event.clientY, event.currentTarget)
        }}
      >
        {strategyShortcutActionId ? (
          <ShortcutTooltip actionId={strategyShortcutActionId} label={item.label} mode="shortcut">
            {workspaceLink}
          </ShortcutTooltip>
        ) : workspaceLink}
        {capabilityMenuId ? (
          <button
            type="button"
            className="sb-workspace-capability-menu"
            aria-label={`${item.label}可见工作区`}
            aria-haspopup="menu"
            aria-expanded={capabilityMenuOpen}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              openCapabilityMenu(rect.left, rect.bottom + 4, event.currentTarget)
            }}
          >
            <MoreHorizontal size={ICON_SM} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="sidebar" data-density={density} aria-label="侧栏">
      <div className="sb-header">
        <Menu
          align="left"
          trigger={
            <button
              type="button"
              className="sb-ws"
              aria-label={`${profile.displayName}；账户菜单`}
            >
              <UserAvatar className="sb-ws-avatar" shape="rounded-square" />
              <span className="sb-ws-name">{profile.displayName}</span>
              <ChevronDown size={ICON_SM} className="sb-ws-chevron" aria-hidden />
            </button>
          }
          options={[
            {
              value: 'settings',
              label: '设置',
              icon: <Settings2 size={ICON_MD} />,
            },
            {
              value: 'trash',
              label: trashCount > 0 ? `回收站 · ${trashCount}` : '回收站',
              icon: <Trash2 size={ICON_MD} />,
            },
          ]}
          value={path.startsWith('/settings') ? 'settings' : path === '/trade-trash' ? 'trash' : undefined}
          onSelect={(value) => {
            if (value === 'settings') navigate('/settings')
            if (value === 'trash') navigate('/trade-trash')
          }}
        />
        <div className="sb-header-actions">
          <ShortcutTooltip actionId="global.commandPalette" label="搜索">
            <button
              type="button"
              className="sb-hbtn sb-hbtn-search"
              onClick={onOpenSearch}
            >
              <Search size={ICON_MD} />
            </button>
          </ShortcutTooltip>
          <ShortcutTooltip actionId="global.newTrade" label="记录交易">
            <button
              type="button"
              className="sb-hbtn sb-hbtn-create"
              aria-label="记录交易"
              onClick={() => openComposer(null, newTradeKindForPath(path, search))}
            >
              <Compose size={ICON_MD} />
            </button>
          </ShortcutTooltip>
        </div>
      </div>

      <div className="sb-scroll">
      <nav className="sb-section sb-primary" aria-label="主要导航">
        <div className="sb-section-label">工作区</div>
        {primaryNav.map(({ id, to, label, icon: Icon }) => {
          const active = selection.activePrimaryId === id
          const contextOnly = active && selection.primaryContextOnly
          return (
            <div
              key={id}
              className={`sb-sortable-row${active && !contextOnly ? ' is-active is-page-active' : ''}${contextOnly ? ' is-context-active' : ''}`}
              data-primary-id={id}
              style={activeIconStyle('var(--nav-active-icon)')}
            >
              <Link
                to={primaryHref(id, to)}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                className="sb-item"
                data-primary-id={id}
                aria-current={active ? (contextOnly ? 'location' : 'page') : undefined}
              >
                <Icon size={ICON_MD} />
                <span className="sb-item-label">{label}</span>
              </Link>
            </div>
          )
        })}
      </nav>

      <nav className="sb-section sb-workspace" aria-label="我的空间">
        <div className="sb-section-label sb-workspace-heading">
          <span>更多</span>
          <button
            type="button"
            className="sb-workspace-menu"
            aria-label="管理我的空间"
            aria-expanded={workspaceEditorOpen}
            aria-controls={SIDEBAR_WORKSPACE_EDITOR_ID}
            onClick={(event) => openWorkspaceEditor(event.currentTarget)}
          >
            <MoreHorizontal size={ICON_SM} aria-hidden="true" />
          </button>
        </div>
        <NavLink
          to="/notes"
          data-primary-id="quickNotes"
          style={activeIconStyle('var(--nav-active-icon)')}
          className={({ isActive }) => `sb-item${isActive ? ' is-active is-page-active' : ''}`}
        >
          <Bookmark size={ICON_MD} />
          <span className="sb-item-label">随记</span>
        </NavLink>
        {pinnedWorkspaceItems.map(renderWorkspaceLink)}
        {overflowWorkspaceItems.length > 0 ? (
          <div className="sb-workspace-overflow" data-sidebar-overflow>
            <div className="sb-workspace-overflow-heading">
              <span className="sb-section-label sb-workspace-overflow-label">更多</span>
              <button
                type="button"
                className="sb-workspace-overflow-manage"
                aria-label="管理更多项目"
                aria-expanded={workspaceEditorOpen}
                aria-controls={SIDEBAR_WORKSPACE_EDITOR_ID}
                onClick={(event) => openWorkspaceEditor(event.currentTarget, 'overflow')}
              >
                管理
              </button>
            </div>
            {overflowWorkspaceItems.map(renderWorkspaceLink)}
          </div>
        ) : null}
        <button
          type="button"
          className="sb-workspace-manage"
          aria-label="添加或管理我的空间"
          aria-expanded={workspaceEditorOpen}
          aria-controls={SIDEBAR_WORKSPACE_EDITOR_ID}
          onClick={(event) => openWorkspaceEditor(event.currentTarget)}
        >
          <Plus size={ICON_SM} aria-hidden="true" />
          <span>添加或管理</span>
        </button>
      </nav>
      </div>

      <div className="sb-footer">
        <SidebarRiskStatus currentTradingDayKey={sidebarDateAnchor.currentTradingDayKey} />
      </div>

      {workspaceEditorOpen ? (
        <div ref={workspaceEditorExitRef} className="sb-workspace-editor-portal" role="presentation">
          <button
            type="button"
            className="sb-workspace-editor-backdrop"
            aria-label="关闭管理我的空间"
            tabIndex={-1}
            onClick={closeWorkspaceEditor}
          />
          <SidebarWorkspaceEditor
            items={sidebarWorkspaceItems}
            primaryOrder={primaryOrder}
            sources={{ savedViews: savedTradeViews, strategies }}
            initialSection={workspaceEditorSection}
            onCommit={(items, nextPrimaryOrder) => {
              replaceSidebarWorkspaceItems(items)
              setDisplay({ sidebarPrimaryOrder: nextPrimaryOrder })
              closeWorkspaceEditor()
            }}
            onCancel={closeWorkspaceEditor}
          />
        </div>
      ) : null}

      <ContextMenu
        state={capabilityMenu}
        onClose={() => setCapabilityMenu(null)}
      />

    </aside>
  )
}
