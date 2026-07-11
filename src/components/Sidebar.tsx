import { NavLink, useLocation } from 'react-router-dom'
import { PenSquare, Search, Settings2, Trash2 } from 'lucide-react'
import { UserAvatar } from '@/components/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  PRIMARY_NAV,
  isSidebarNavActive,
  resolvePinnedSecondaryNav,
  type PrimarySidebarNavId,
  type SidebarNavId,
} from '@/lib/sidebarNav'
import { filterTrades } from '@/lib/tradeFilters'
import { tradeInPeriod } from '@/lib/periods'
import {
  rememberableWorkspaceKind,
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
} from '@/lib/workspaceViews'
import { useStore } from '@/store/useStore'
import './Sidebar.css'

function Count({ value }: { value?: number }) {
  if (!value) return null
  return <span className="sb-item-count">{value}</span>
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const { pathname: path } = useLocation()
  const openComposer = useStore((state) => state.openComposer)
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const profile = useStore((state) => state.profile)
  const workspaceMemory = useStore((state) => state.display.workspaceMemory)
  const starredIds = useStore((state) => state.starredIds)
  const sidebarPins = useStore((state) => state.display.sidebarPins)
  const quickNav = resolvePinnedSecondaryNav(sidebarPins)

  const activeTrades = trades.filter((trade) => !trade.deletedAt)
  const liveTrades = activeTrades.filter((trade) => trade.tradeKind === 'live')
  const reviewCaseTrades = activeTrades.filter((trade) => trade.tradeKind === 'case')
  const inReviewCases = path.startsWith('/review-cases')
  const isSettingsActive = path.startsWith('/settings')

  const todayHref = workspaceRouteHref(
    resolveWorkspaceNavTarget('today', workspaceMemory?.today, strategies),
  )
  const tradeHref = workspaceRouteHref(
    resolveWorkspaceNavTarget('trade', workspaceMemory?.trade, strategies),
  )
  const caseHref = workspaceRouteHref(
    resolveWorkspaceNavTarget('case', workspaceMemory?.case),
  )

  const counts = {
    today: liveTrades.filter((trade) => tradeInPeriod(trade, 'today')).length,
    trades: liveTrades.length,
    reviewCases: reviewCaseTrades.length,
  }

  const primaryCount = (id: PrimarySidebarNavId) => {
    if (id === 'today') return counts.today
    if (id === 'trades') return counts.trades
    if (id === 'reviewCases') return counts.reviewCases
    return undefined
  }

  const secondaryCount = (id: SidebarNavId): number | undefined => {
    if (id === 'active') {
      return filterTrades(activeTrades, { type: 'active', tradeKind: 'live' }, starredIds).length
    }
    if (id === 'favorites') {
      return filterTrades(activeTrades, { type: 'starred' }, starredIds).length
    }
    if (id === 'missed') {
      return filterTrades(activeTrades, { type: 'missed' }, starredIds).length
    }
    if (id === 'paper') {
      return filterTrades(activeTrades, { type: 'all', tradeKind: 'paper' }, starredIds).length
    }
    return undefined
  }

  const primaryHref = (id: PrimarySidebarNavId, fallback: string) => {
    if (id === 'today') return todayHref
    if (id === 'trades') return tradeHref
    if (id === 'reviewCases') return caseHref
    return fallback
  }

  const primaryActive = (id: PrimarySidebarNavId, fallback: string) => {
    if (id === 'trades') return rememberableWorkspaceKind(path) === 'trade'
    if (id === 'reviewCases') return rememberableWorkspaceKind(path) === 'case'
    return isSidebarNavActive(path, fallback)
  }

  const createLabel = inReviewCases ? '新建案例记录' : '新建交易'

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
            className={() => 'sb-item' + (primaryActive(id, to) ? ' is-active' : '')}
          >
            <Icon size={16} />
            <span>{label}</span>
            <Count value={primaryCount(id)} />
          </NavLink>
        ))}
      </nav>

      {quickNav.length > 0 ? (
        <nav className="sb-section sb-quick" aria-label="快捷导航">
          <div className="sb-section-label">快捷</div>
          {quickNav.map(({ id, to, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={to}
              className={() =>
                'sb-item' + (isSidebarNavActive(path, to) ? ' is-active' : '')
              }
            >
              <Icon size={16} />
              <span>{label}</span>
              <Count value={secondaryCount(id)} />
            </NavLink>
          ))}
        </nav>
      ) : null}

      <div className="sb-spacer" />

      <nav className="sb-section sb-utility" aria-label="辅助导航">
        <NavLink
          to="/trade-trash"
          className={() =>
            'sb-item sb-trash' + (path === '/trade-trash' ? ' is-active' : '')
          }
        >
          <Trash2 size={16} />
          <span>回收站</span>
          <Count value={trades.filter((trade) => Boolean(trade.deletedAt)).length} />
        </NavLink>
        <NavLink
          to="/settings"
          className={() => 'sb-item sb-settings' + (isSettingsActive ? ' is-active' : '')}
        >
          <Settings2 size={16} />
          <span>设置</span>
        </NavLink>
      </nav>
    </aside>
  )
}
