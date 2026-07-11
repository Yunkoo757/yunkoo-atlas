import { useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Ban,
  BookOpen,
  Bookmark,
  CircleDot,
  FlaskConical,
  PenSquare,
  Search,
  Settings2,
  Star,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { UserAvatar } from '@/components/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { PRIMARY_NAV, type PrimarySidebarNavId } from '@/lib/sidebarNav'
import {
  countSidebarRoute,
  countSidebarTarget,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  type ResolvedSidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { resolveWorkspaceNavTarget, workspaceRouteHref } from '@/lib/workspaceViews'
import { useStore } from '@/store/useStore'
import {
  SIDEBAR_WORKSPACE_EDITOR_ID,
  SidebarWorkspaceEditor,
} from '@/components/sidebar/SidebarWorkspaceEditor'
import './Sidebar.css'
import './sidebar/SidebarWorkspace.css'

function Count({ value }: { value?: number }) {
  if (!value) return null
  return <span className="sb-item-count">{value}</span>
}

export const WORKSPACE_ICONS: Record<ResolvedSidebarWorkspaceItem['icon'], LucideIcon> = {
  active: CircleDot,
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
  const countContext = { trades, starredIds, display }

  const workspaceItems = sidebarWorkspaceItems
    .map((item) => resolveSidebarWorkspaceItem(item, { savedViews: savedTradeViews, strategies }))
    .filter((item) => !item.invalid)
    .map((item) => ({
      ...item,
      count: countSidebarTarget(item, countContext),
    }))
  const selection = resolveSidebarSelection({ pathname: path, search, items: workspaceItems })
  const workspaceMemory = display.workspaceMemory
  const todayTarget = resolveWorkspaceNavTarget('today', workspaceMemory?.today, strategies)
  const tradeTarget = resolveWorkspaceNavTarget('trade', workspaceMemory?.trade, strategies)
  const caseTarget = resolveWorkspaceNavTarget('case', workspaceMemory?.case)
  const counts = {
    today: countSidebarRoute(todayTarget.pathname, todayTarget.search, countContext),
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
  const workspaceEditorOpener = useRef<HTMLButtonElement | null>(null)
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

  const inReviewCases = path.startsWith('/review-cases')
  const isSettingsActive = path.startsWith('/settings')

  const createLabel = inReviewCases ? '新建案例记录' : '新建交易'
  const openWorkspaceEditor = (button: HTMLButtonElement) => {
    workspaceEditorOpener.current = button
    setWorkspaceEditorOpen(true)
  }
  const closeWorkspaceEditor = () => {
    setWorkspaceEditorOpen(false)
    requestAnimationFrame(() => workspaceEditorOpener.current?.focus())
  }

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <NavLink to="/settings/profile" className="sb-ws">
          <UserAvatar className="sb-ws-avatar" />
          <span className="sb-ws-name">{profile.displayName}</span>
        </NavLink>
        <div className="sb-header-actions">
          <Tooltip content="搜索" label="搜索">
            <button
              type="button"
              className="sb-hbtn"
              aria-label="搜索 (Ctrl+K)"
              onClick={onOpenSearch}
            >
              <Search size={16} />
            </button>
          </Tooltip>
          <Tooltip content={createLabel} label={createLabel}>
            <button
              type="button"
              className="sb-hbtn"
              aria-label={createLabel}
              onClick={() => openComposer()}
            >
              <PenSquare size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <nav className="sb-section sb-primary" aria-label="主要导航">
        <div className="sb-section-label">工作台</div>
        {PRIMARY_NAV.map(({ id, to, label, icon: Icon }) => (
          <NavLink
            key={id}
            to={primaryHref(id, to)}
            className={() => 'sb-item' + (selection.activePrimaryId === id ? ' is-active' : '')}
            aria-current={selection.activePrimaryId === id ? 'page' : undefined}
          >
            <Icon size={16} />
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
            ···
          </button>
        </div>
        {pinnedWorkspaceItems.map((item) => {
          const Icon = WORKSPACE_ICONS[item.icon]
          const active = selection.activeWorkspaceItemId === item.item.id
          const modified = selection.modifiedWorkspaceItemId === item.item.id
          return (
            <NavLink
              key={item.item.id}
              to={workspaceRouteHref(item)}
              className={() => `sb-item${active ? ' is-active' : ''}${modified ? ' is-modified' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} />
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
        })}
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
        {workspaceEditorOpen ? (
          <SidebarWorkspaceEditor
            items={sidebarWorkspaceItems}
            sources={{ savedViews: savedTradeViews, strategies }}
            onCommit={(items) => {
              replaceSidebarWorkspaceItems(items)
              closeWorkspaceEditor()
            }}
            onCancel={closeWorkspaceEditor}
          />
        ) : null}
      </nav>

      <div className="sb-spacer" />

      <nav className="sb-section sb-utility" aria-label="辅助导航">
        <NavLink
          to="/trade-trash"
          className={() =>
            'sb-item sb-trash' + (path === '/trade-trash' ? ' is-active' : '')
          }
        >
          <Trash2 size={16} />
          <span className="sb-item-label">回收站</span>
          <Count value={trades.filter((trade) => Boolean(trade.deletedAt)).length} />
        </NavLink>
        <NavLink
          to="/settings"
          className={() => 'sb-item sb-settings' + (isSettingsActive ? ' is-active' : '')}
        >
          <Settings2 size={16} />
          <span className="sb-item-label">设置</span>
        </NavLink>
      </nav>
    </aside>
  )
}
