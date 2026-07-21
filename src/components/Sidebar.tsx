import { Fragment, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { AppIcon } from '@/icons/appIcons'
import {
  ChevronDown,
  Ban,
  BookOpen,
  Bookmark,
  Clock,
  FlaskConical,
  Compose,
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
import {
  reorderPrimarySidebarNav,
  resolvePrimarySidebarNav,
  type PrimarySidebarNavId,
} from '@/lib/sidebarNav'
import {
  countSidebarRoute,
  countSidebarTarget,
  reorderSidebarWorkspaceItem,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  type ResolvedSidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { resolveWorkspaceNavTarget, workspaceRouteHref } from '@/lib/workspaceViews'
import { getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'
import { getTradingDayKey } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import {
  SIDEBAR_WORKSPACE_EDITOR_ID,
  SidebarWorkspaceEditor,
} from '@/components/sidebar/SidebarWorkspaceEditor'
import { ICON_MD } from '@/icons/iconSize'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { createQuickNote } from '@/data/quickNotes'
import { useExitClone } from '@/components/ui/useExitClone'

const PRIMARY_NAV_SHORTCUT: Partial<Record<PrimarySidebarNavId, string>> = {
  today: 'nav.today',
  quickNotes: 'nav.quickNotes',
  trades: 'nav.list',
  reviewCases: 'nav.reviewCases',
  weeklyReview: 'nav.weeklyReview',
  reviewSession: 'nav.reviewSession',
  dashboard: 'nav.dashboard',
}
import './Sidebar.css'
import './sidebar/SidebarWorkspace.css'

const WORKSPACE_DRAG_THRESHOLD_PX = 5

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
  const starredIds = useStore((state) => state.starredIds)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const sidebarPrimaryOrder = useStore((state) => state.display.sidebarPrimaryOrder)
  const savedTradeViews = useStore((state) => state.savedTradeViews)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
  const setDisplay = useStore((state) => state.setDisplay)
  const countContext = useMemo(() => ({ trades, starredIds, display }), [trades, starredIds, display])

  const workspaceItems = useMemo(
    () => sidebarWorkspaceItems
      .map((item) => resolveSidebarWorkspaceItem(item, { savedViews: savedTradeViews, strategies }))
      .filter((item) => !item.invalid)
      .map((item) => ({
        ...item,
        count: countSidebarTarget(item, countContext),
      })),
    [countContext, savedTradeViews, sidebarWorkspaceItems, strategies],
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
      getTradingDayKey(new Date(), display.tradingDayStartHour),
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
    sidebarPrimaryOrder,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    setDisplay,
    workspaceItems,
    selection,
    primaryCount,
    primaryHref,
  }
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const navigate = useNavigate()
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false)
  const [workspaceEditorSection, setWorkspaceEditorSection] = useState<'pinned' | 'overflow'>('pinned')
  const [workspaceDrag, setWorkspaceDrag] = useState<SidebarDragState | null>(null)
  const [primaryDrag, setPrimaryDrag] = useState<SidebarDragState | null>(null)
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
  const primaryDragSession = useRef<{
    id: PrimarySidebarNavId
    pointerId: number
    startX: number
    startY: number
    active: boolean
    overId: PrimarySidebarNavId | null
  } | null>(null)
  const suppressPrimaryClick = useRef(false)
  const workspaceEditorExitRef = useExitClone<HTMLDivElement>(workspaceEditorOpen)
  const openComposer = useStore((state) => state.openComposer)
  const upsertQuickNote = useStore((state) => state.upsertQuickNote)
  const profile = useStore((state) => state.profile)
  const {
    path,
    trades,
    strategies,
    sidebarWorkspaceItems,
    sidebarPrimaryOrder,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    setDisplay,
    workspaceItems,
    selection,
    primaryCount,
    primaryHref,
  } = useSidebarNavigationModel()
  const orderedPrimaryNav = useMemo(
    () => resolvePrimarySidebarNav(sidebarPrimaryOrder),
    [sidebarPrimaryOrder],
  )
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

  const finishPrimaryDrag = (commit: boolean) => {
    const session = primaryDragSession.current
    primaryDragSession.current = null
    setPrimaryDrag(null)
    if (!commit || !session?.active || !session.overId || session.overId === session.id) return
    setDisplay({
      sidebarPrimaryOrder: reorderPrimarySidebarNav(
        sidebarPrimaryOrder,
        session.id,
        session.overId,
      ),
    })
  }

  const onPrimaryPointerDown = (
    event: ReactPointerEvent<HTMLAnchorElement>,
    id: PrimarySidebarNavId,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    primaryDragSession.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overId: null,
    }
  }

  const onPrimaryPointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const session = primaryDragSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (!session.active) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
      if (distance < WORKSPACE_DRAG_THRESHOLD_PX) return
      session.active = true
      suppressPrimaryClick.current = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 捕获失败时仍靠后续 pointer 事件收尾
      }
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const row = hit?.closest<HTMLElement>('[data-sidebar-primary-id]')
    const overId = row?.dataset.sidebarPrimaryId as PrimarySidebarNavId | undefined
    session.overId = overId && overId !== session.id ? overId : null
    setPrimaryDrag({ id: session.id, overId: session.overId })
  }

  const onPrimaryPointerUp = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const session = primaryDragSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (session.active) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
    finishPrimaryDrag(true)
  }

  const onPrimaryPointerCancel = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (primaryDragSession.current?.pointerId !== event.pointerId) return
    finishPrimaryDrag(false)
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
    const link = (
      <NavLink
        key={item.item.id}
        to={workspaceRouteHref(item)}
        draggable={false}
        data-sidebar-workspace-id={item.item.id}
        data-sidebar-workspace-placement={item.item.placement}
        className={() =>
          `sb-item${active ? ' is-active' : ''}${modified ? ' is-modified' : ''}${
            isDragging ? ' is-dragging' : ''
          }${isDropTarget ? ' is-drop-target' : ''}`
        }
        data-ws-icon={item.icon}
        aria-current={active ? 'page' : undefined}
        onDragStart={(event) => {
          // 禁止 Electron/浏览器把 NavLink 拖成 file:// 预览
          event.preventDefault()
        }}
        onPointerDown={(event) => onWorkspacePointerDown(event, item)}
        onPointerMove={onWorkspacePointerMove}
        onPointerUp={onWorkspacePointerUp}
        onPointerCancel={onWorkspacePointerCancel}
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
        <Count value={item.count} />
      </NavLink>
    )
    return link
  }

  return (
    <aside className={'sidebar' + (workspaceDrag || primaryDrag ? ' is-reordering' : '')}>
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
              <ChevronDown size={14} className="sb-ws-chevron" aria-hidden />
            </button>
          }
          options={[
            {
              value: 'settings',
              label: '设置',
              icon: <Settings2 size={15} />,
            },
            {
              value: 'trash',
              label: trashCount > 0 ? `回收站 · ${trashCount}` : '回收站',
              icon: <Trash2 size={15} />,
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
        {orderedPrimaryNav.map(({ id, to, label, icon: Icon }) => {
          const isDragging = primaryDrag?.id === id
          const isDropTarget = primaryDrag?.overId === id
          const shortcutActionId = PRIMARY_NAV_SHORTCUT[id]
          const link = (
            <NavLink
              to={primaryHref(id, to)}
              draggable={false}
              data-sidebar-primary-id={id}
              onDragStart={(event) => event.preventDefault()}
              className={() => `sb-item${selection.activePrimaryId === id ? ' is-active' : ''}${
                isDragging ? ' is-dragging' : ''
              }${isDropTarget ? ' is-drop-target' : ''}`}
              data-primary-id={id}
              aria-current={selection.activePrimaryId === id ? 'page' : undefined}
              onPointerDown={(event) => onPrimaryPointerDown(event, id)}
              onPointerMove={onPrimaryPointerMove}
              onPointerUp={onPrimaryPointerUp}
              onPointerCancel={onPrimaryPointerCancel}
              onClick={(event) => {
                if (!suppressPrimaryClick.current) return
                event.preventDefault()
                suppressPrimaryClick.current = false
              }}
            >
              <Icon size={ICON_MD} />
              <span className="sb-item-label">{label}</span>
              <Count value={primaryCount(id)} />
            </NavLink>
          )
          if (!shortcutActionId) return <Fragment key={id}>{link}</Fragment>
          return (
            <ShortcutTooltip
              key={id}
              actionId={shortcutActionId}
              label={label}
              mode="shortcut"
              side="right"
            >
              {link}
            </ShortcutTooltip>
          )
        })}
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
            ···
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
          <span aria-hidden="true">＋</span>
          <span>添加或管理</span>
        </button>
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

    </aside>
  )
}
