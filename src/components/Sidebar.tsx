import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { AppIcon } from '@/icons/appIcons'
import {
  ChevronDown,
  Archive,
  Ban,
  BookOpen,
  Bookmark,
  Clock,
  FlaskConical,
  Compose,
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
  resolvePrimarySidebarNav,
  type PrimarySidebarNavId,
} from '@/lib/sidebarNav'
import {
  SIDEBAR_CAPABILITY_WORKSPACES,
  SIDEBAR_QUICK_WORKSPACE_LABELS,
  countSidebarRoute,
  countSidebarTarget,
  isCapabilityEnabledForWorkspace,
  isSidebarCapabilityId,
  reorderSidebarWorkspaceItem,
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
import { getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import {
  SIDEBAR_WORKSPACE_EDITOR_ID,
  SidebarWorkspaceEditor,
} from '@/components/sidebar/SidebarWorkspaceEditor'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { createQuickNote } from '@/data/quickNotes'
import { useExitClone } from '@/components/ui/useExitClone'

import './Sidebar.css'
import './sidebar/SidebarWorkspace.css'

const WORKSPACE_DRAG_THRESHOLD_PX = 5

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

type SidebarDragState = {
  id: string
  overId: string | null
}

function Count({ value }: { value?: number }) {
  return (
    <span
      className={'sb-item-count' + (!value ? ' is-empty' : '')}
      aria-hidden={!value}
    >
      {value || 0}
    </span>
  )
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

export function useSidebarNavigationModel() {
  const { pathname: path, search } = useLocation()
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const display = useStore((state) => state.display)
  const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
  const livePerformanceCycles = useStore((state) => state.livePerformanceCycles)
  const starredIds = useStore((state) => state.starredIds)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const savedTradeViews = useStore((state) => state.savedTradeViews)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
  const businessDateAnchor = useBusinessDateAnchor()
  const countContext = useMemo(
    () => ({
      trades,
      starredIds,
      display,
      businessDateAnchor,
      liveStatsStartTradingDayKey,
      livePerformanceCycles,
    }),
    [
      trades,
      starredIds,
      display,
      businessDateAnchor,
      liveStatsStartTradingDayKey,
      livePerformanceCycles,
    ],
  )

  const workspaceItems = useMemo(
    () => sidebarWorkspaceItems
      .map((item) => resolveSidebarWorkspaceItem(
        item,
        { savedViews: savedTradeViews, strategies, livePerformanceCycles },
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
      .map((item) => ({
        ...item,
        count: countSidebarTarget(item, countContext),
      })),
    [
      countContext,
      livePerformanceCycles,
      path,
      savedTradeViews,
      sidebarWorkspaceItems,
      strategies,
    ],
  )
  const selection = useMemo(
    () => resolveSidebarSelection({ pathname: path, search, items: workspaceItems }),
    [path, search, workspaceItems],
  )
  const workspaceMemory = display.workspaceMemory
  const todayTarget = { pathname: '/today-record', search: '' }
  const tradeTarget = resolveWorkspaceNavTarget('trade', workspaceMemory?.trade, strategies)
  const caseTarget = resolveWorkspaceNavTarget('case', workspaceMemory?.case)
  const counts = {
    today: getTodayWorkflowBuckets(
      trades,
      businessDateAnchor.currentTradingDayKey,
      display.tradingDayStartHour,
    ).actionCount,
    trades: countSidebarRoute(tradeTarget.pathname, tradeTarget.search, countContext),
    reviewCases: countSidebarRoute(caseTarget.pathname, caseTarget.search, countContext),
  }
  const primaryCount = (id: PrimarySidebarNavId) => {
    if (id === 'today') return counts.today
    if (id === 'trades') return counts.trades
    if (id === 'reviewCases') return counts.reviewCases
    return undefined
  }
  const primaryHref = (id: PrimarySidebarNavId, fallback: string) => {
    if (id === 'today') return workspaceRouteHref(todayTarget)
    if (id === 'trades') return workspaceRouteHref(tradeTarget)
    if (id === 'reviewCases') return workspaceRouteHref(caseTarget)
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
    primaryCount,
    primaryHref,
  }
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const density = useSidebarDensity()
  const navigate = useNavigate()
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false)
  const [workspaceEditorSection, setWorkspaceEditorSection] = useState<'pinned' | 'overflow'>('pinned')
  const [workspaceDrag, setWorkspaceDrag] = useState<SidebarDragState | null>(null)
  const [capabilityMenu, setCapabilityMenu] = useState<(CtxState & { itemId: string }) | null>(null)
  const workspaceEditorOpener = useRef<HTMLButtonElement | null>(null)
  const workspaceDragSession = useRef<{
    id: string
    placement: 'pinned' | 'overflow'
    pointerId: number
    startX: number
    startY: number
    active: boolean
    overId: string | null
  } | null>(null)
  const suppressWorkspaceClick = useRef(false)
  const workspaceEditorExitRef = useExitClone<HTMLDivElement>(workspaceEditorOpen)
  const openComposer = useStore((state) => state.openComposer)
  const upsertQuickNote = useStore((state) => state.upsertQuickNote)
  const profile = useStore((state) => state.profile)
  const {
    path,
    trades,
    strategies,
    sidebarWorkspaceItems,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    workspaceItems,
    selection,
    primaryCount,
    primaryHref,
  } = useSidebarNavigationModel()
  const pinnedWorkspaceItems = workspaceItems
    .filter((item) => item.item.placement === 'pinned')
    .slice(0, 8)
  const overflowWorkspaceItems = workspaceItems.filter(
    (item) => item.item.placement === 'overflow',
  )

  const inReviewCases = path.startsWith('/review-cases')
  const inQuickNotes = path === '/notes' || path.startsWith('/notes/')
  const trashCount = trades.filter((trade) => Boolean(trade.deletedAt)).length

  const createLabel = inQuickNotes ? '新建随记' : inReviewCases ? '新建案例记录' : '新建交易'
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

  const finishWorkspaceDrag = (commit: boolean) => {
    const session = workspaceDragSession.current
    workspaceDragSession.current = null
    setWorkspaceDrag(null)
    if (!commit || !session?.active || !session.overId || session.overId === session.id) return
    const next = reorderSidebarWorkspaceItem(sidebarWorkspaceItems, session.id, session.overId)
    if (next !== sidebarWorkspaceItems) {
      replaceSidebarWorkspaceItems(next)
    }
  }

  const resolveWorkspaceDropTarget = (
    clientX: number,
    clientY: number,
    placement: 'pinned' | 'overflow',
    sourceId: string,
  ) => {
    const hit = document.elementFromPoint(clientX, clientY)
    const row = hit?.closest<HTMLElement>('[data-sidebar-workspace-id]')
    const overId = row?.dataset.sidebarWorkspaceId
    if (!overId || overId === sourceId) return null
    const overItem = workspaceItems.find((item) => item.item.id === overId)
    if (!overItem || overItem.item.placement !== placement) return null
    return overId
  }

  const onWorkspacePointerDown = (
    event: ReactPointerEvent<HTMLAnchorElement>,
    item: (typeof workspaceItems)[number],
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    workspaceDragSession.current = {
      id: item.item.id,
      placement: item.item.placement,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overId: null,
    }
  }

  const onWorkspacePointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const session = workspaceDragSession.current
    if (!session || session.pointerId !== event.pointerId) return

    if (!session.active) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
      if (distance < WORKSPACE_DRAG_THRESHOLD_PX) return
      session.active = true
      suppressWorkspaceClick.current = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 捕获失败时仍靠后续 pointer 事件收尾
      }
    }

    const overId = resolveWorkspaceDropTarget(
      event.clientX,
      event.clientY,
      session.placement,
      session.id,
    )
    session.overId = overId
    setWorkspaceDrag({
      id: session.id,
      overId,
    })
  }

  const onWorkspacePointerUp = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const session = workspaceDragSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (session.active) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
    finishWorkspaceDrag(true)
  }

  const onWorkspacePointerCancel = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const session = workspaceDragSession.current
    if (!session || session.pointerId !== event.pointerId) return
    finishWorkspaceDrag(false)
  }

  const renderWorkspaceLink = (item: (typeof workspaceItems)[number]) => {
    const Icon = WORKSPACE_ICONS[item.icon]
    const strategyTarget = item.item.target.kind === 'strategy' ? item.item.target : undefined
    const strategy = strategyTarget
      ? strategies.find((candidate) => candidate.id === strategyTarget.strategyId)
      : undefined
    const active = selection.activeWorkspaceItemId === item.item.id
    const modified = selection.modifiedWorkspaceItemId === item.item.id
    const isDragging = workspaceDrag?.id === item.item.id
    const isDropTarget = workspaceDrag?.overId === item.item.id
    const capabilityId =
      item.item.target.kind === 'system' && isSidebarCapabilityId(item.item.target.id)
        ? item.item.target.id
        : null
    const capabilityMenuId = capabilityId === 'missed' ? null : capabilityId
    const capabilityMenuOpen = Boolean(capabilityMenuId && capabilityMenu?.itemId === item.item.id)

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

    const openCapabilityMenu = (x: number, y: number) => {
      if (!capabilityMenuId) return
      setCapabilityMenu({
        itemId: item.item.id,
        x,
        y,
        items: buildCapabilityVisibilityItems(
          capabilityMenuId,
          item.label,
          useStore.getState().display.sidebarWorkspaceItems,
          toggleCapabilityWorkspace,
        ),
      })
    }

    return (
      <NavLink
        key={item.item.id}
        to={workspaceRouteHref(item)}
        draggable={false}
        data-sidebar-workspace-id={item.item.id}
        data-sidebar-workspace-placement={item.item.placement}
        data-sidebar-capability={capabilityId ?? undefined}
        className={() =>
          `sb-item${active ? ' is-active' : ''}${modified ? ' is-modified' : ''}${
            isDragging ? ' is-dragging' : ''
          }${isDropTarget ? ' is-drop-target' : ''}${
            capabilityMenuOpen ? ' is-capability-menu-open' : ''
          }`
        }
        data-ws-icon={item.icon}
        aria-current={active ? 'page' : 'false'}
        onDragStart={(event) => {
          // 禁止 Electron/浏览器把 NavLink 拖成 file:// 预览
          event.preventDefault()
        }}
        onPointerDown={(event) => onWorkspacePointerDown(event, item)}
        onPointerMove={onWorkspacePointerMove}
        onPointerUp={onWorkspacePointerUp}
        onPointerCancel={onWorkspacePointerCancel}
        onContextMenu={(event) => {
          if (!capabilityMenuId) return
          event.preventDefault()
          openCapabilityMenu(event.clientX, event.clientY)
        }}
        onClick={(event) => {
          if (!suppressWorkspaceClick.current) return
          event.preventDefault()
          suppressWorkspaceClick.current = false
        }}
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
        {modified ? (
          <span className="sb-modified-indicator">
            <span className="sb-modified-dot" aria-hidden="true" />
            <span className="sb-screen-reader">当前条件已修改</span>
          </span>
        ) : null}
        {capabilityMenuId ? (
          <button
            type="button"
            className="sb-workspace-capability-menu"
            aria-label={`${item.label}可见工作区`}
            aria-haspopup="menu"
            aria-expanded={capabilityMenuOpen}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              openCapabilityMenu(rect.left, rect.bottom + 4)
            }}
          >
            <MoreHorizontal size={ICON_SM} aria-hidden="true" />
          </button>
        ) : null}
        <Count value={item.count} />
      </NavLink>
    )
  }

  return (
    <nav
      className={'sidebar' + (workspaceDrag ? ' is-reordering' : '')}
      data-density={density}
      aria-label="主导航"
    >
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
          <ShortcutTooltip
            actionId={inQuickNotes ? 'global.newQuickNote' : inReviewCases ? 'global.newCase' : 'global.newTrade'}
            label={createLabel}
          >
            <button
              type="button"
              className="sb-hbtn sb-hbtn-create"
              onClick={() => {
                if (inQuickNotes) {
                  const note = createQuickNote()
                  upsertQuickNote(note)
                  navigate(`/notes/${encodeURIComponent(note.id)}`)
                  return
                }
                openComposer(null, inReviewCases ? 'case' : newTradeKindForPath(path))
              }}
              aria-label={createLabel}
            >
              <Compose size={ICON_MD} />
            </button>
          </ShortcutTooltip>
        </div>
      </div>

      <div className="sb-scroll">
      <nav className="sb-section sb-primary" aria-label="主要导航">
        <div className="sb-section-label">工作台</div>
        {resolvePrimarySidebarNav().map(({ id, to, label, icon: Icon }) => (
          <NavLink
            key={id}
            to={primaryHref(id, to)}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            className={() => `sb-item${selection.activePrimaryId === id ? ' is-active' : ''}`}
            data-primary-id={id}
            aria-current={selection.activePrimaryId === id ? 'page' : undefined}
          >
            <Icon size={ICON_MD} />
            <span className="sb-item-label">{label}</span>
            <Count value={primaryCount(id)} />
          </NavLink>
        ))}
      </nav>

      <nav className="sb-section sb-workspace" aria-label="我的空间">
        <div className="sb-section-label sb-workspace-heading">
          <span>我的空间</span>
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
      <nav className="sb-section" aria-label="历史记录">
        <NavLink
          to="/live-archive"
          data-primary-id="liveArchive"
          className={({ isActive }) => `sb-item${isActive ? ' is-active' : ''}`}
        >
          <Archive size={ICON_MD} />
          <span className="sb-item-label">历史记录</span>
        </NavLink>
      </nav>
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
            sources={{ savedViews: savedTradeViews, strategies }}
            initialSection={workspaceEditorSection}
            onCommit={(items) => {
              replaceSidebarWorkspaceItems(items)
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

    </nav>
  )
}
