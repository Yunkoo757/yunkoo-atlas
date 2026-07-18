import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { AppIcon } from '@/icons/appIcons'
import {
  Ban,
  BookOpen,
  Bookmark,
  Clock,
  FlaskConical,
  Pencil,
  Search,
  Settings2,
  Star,
  Target,
  Trash2,
} from '@/icons/appIcons'
import { UserAvatar } from '@/components/UserAvatar'
import { StrategyIcon } from '@/components/StrategyIcon'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
import { PRIMARY_NAV, type PrimarySidebarNavId } from '@/lib/sidebarNav'
import {
  countSidebarRoute,
  countSidebarTarget,
  reorderSidebarWorkspaceItem,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  type ResolvedSidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { resolveWorkspaceNavTarget, workspaceRouteHref } from '@/lib/workspaceViews'
import { getTodayWorkflowBuckets, toLocalDateKey } from '@/lib/tradeWorkflow'
import { useStore } from '@/store/useStore'
import {
  SIDEBAR_WORKSPACE_EDITOR_ID,
  SidebarWorkspaceEditor,
} from '@/components/sidebar/SidebarWorkspaceEditor'
import { ICON_MD } from '@/icons/iconSize'
import { newTradeKindForPath } from '@/lib/tradeKind'
import './Sidebar.css'
import './sidebar/SidebarWorkspace.css'

const WORKSPACE_DRAG_THRESHOLD_PX = 5

type WorkspaceDragGhost = {
  id: string
  label: string
  overId: string | null
  x: number
  y: number
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
  const savedTradeViews = useStore((state) => state.savedTradeViews)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
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
    today: getTodayWorkflowBuckets(trades, toLocalDateKey()).actionCount,
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
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false)
  const [workspaceEditorSection, setWorkspaceEditorSection] = useState<'pinned' | 'overflow'>('pinned')
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragGhost | null>(null)
  const workspaceEditorOpener = useRef<HTMLButtonElement | null>(null)
  const workspaceDragSession = useRef<{
    id: string
    placement: 'pinned' | 'overflow'
    label: string
    pointerId: number
    startX: number
    startY: number
    active: boolean
    overId: string | null
  } | null>(null)
  const suppressWorkspaceClick = useRef(false)
  const openComposer = useStore((state) => state.openComposer)
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
  const isSettingsActive = path.startsWith('/settings')

  const createLabel = inReviewCases ? '新建案例记录' : '新建交易'
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
      label: item.label,
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
      label: session.label,
      overId,
      x: event.clientX,
      y: event.clientY,
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
    <aside className={'sidebar' + (workspaceDrag ? ' is-reordering' : '')}>
      <div className="sb-header">
        <NavLink
          to="/settings/profile"
          className="sb-ws"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        >
          <UserAvatar className="sb-ws-avatar" />
          <span className="sb-ws-name">{profile.displayName}</span>
        </NavLink>
        <div className="sb-header-actions">
          <ShortcutTooltip actionId="global.commandPalette" label="搜索">
            <button
              type="button"
              className="sb-hbtn"
              onClick={onOpenSearch}
            >
              <Search size={ICON_MD} />
            </button>
          </ShortcutTooltip>
          <ShortcutTooltip
            actionId={inReviewCases ? 'global.newCase' : 'global.newTrade'}
            label={createLabel}
          >
            <button
              type="button"
              className="sb-hbtn"
              onClick={() => openComposer(null, inReviewCases ? 'case' : newTradeKindForPath(path))}
            >
              <Pencil size={ICON_MD} />
            </button>
          </ShortcutTooltip>
        </div>
      </div>

      <nav className="sb-section sb-primary" aria-label="主要导航">
        <div className="sb-section-label">工作台</div>
        {PRIMARY_NAV.map(({ id, to, label, icon: Icon }) => {
          const link = (
            <NavLink
              key={id}
              to={primaryHref(id, to)}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              className={() => 'sb-item' + (selection.activePrimaryId === id ? ' is-active' : '')}
              aria-current={selection.activePrimaryId === id ? 'page' : undefined}
            >
              <Icon size={ICON_MD} />
              <span className="sb-item-label">{label}</span>
              <Count value={primaryCount(id)} />
            </NavLink>
          )
          return link
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

      {workspaceEditorOpen ? (
        <div className="sb-workspace-editor-portal" role="presentation">
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

      <div className="sb-spacer" />

      <nav className="sb-section sb-utility" aria-label="辅助导航">
        <NavLink
          to="/trade-trash"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className={() =>
            'sb-item sb-trash' + (path === '/trade-trash' ? ' is-active' : '')
          }
        >
          <Trash2 size={ICON_MD} />
          <span className="sb-item-label">回收站</span>
          <Count value={trades.filter((trade) => Boolean(trade.deletedAt)).length} />
        </NavLink>
        <NavLink
          to="/settings"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className={() => 'sb-item sb-settings' + (isSettingsActive ? ' is-active' : '')}
        >
          <Settings2 size={ICON_MD} />
          <span className="sb-item-label">设置</span>
        </NavLink>
      </nav>

      {workspaceDrag ? (
        <div
          className="sb-workspace-drag-ghost"
          style={{
            transform: `translate(${workspaceDrag.x + 12}px, ${workspaceDrag.y + 8}px)`,
          }}
          aria-hidden
        >
          {workspaceDrag.label}
        </div>
      ) : null}
    </aside>
  )
}
