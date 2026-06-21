import { NavLink, useLocation } from 'react-router-dom'
import {
  Search,
  PenSquare,
  ListTodo,
  BarChart3,
  CalendarDays,
  Settings2,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import {
  SECONDARY_NAV,
  isSidebarNavActive,
} from '@/lib/sidebarNav'
import { isActive, isMissed } from '@/lib/tradeStatus'
import { CALENDAR_PERIODS, PERIOD_LABELS, tradeInPeriod, type CalendarPeriod } from '@/lib/periods'
import { countTradesByStrategy, sortStrategies } from '@/lib/strategies'
import { StrategyIcon } from '@/components/StrategyIcon'
import { UserAvatar } from '@/components/UserAvatar'
import './Sidebar.css'

const WORKBENCH_NAV = [
  {
    to: '/list',
    label: '交易',
    icon: ListTodo,
    active: (path: string) => path === '/list' || path === '/board',
  },
  {
    to: '/dashboard',
    label: '仪表盘',
    icon: BarChart3,
    active: (path: string) => path === '/dashboard',
  },
] as const

const SIDEBAR_PERIODS: CalendarPeriod[] = ['today', 'this-week']
const MAX_SIDEBAR_STRATEGIES = 5

function SecondaryLink({
  path,
  count,
  item: { to, label, icon: Icon },
}: {
  path: string
  count?: number
  item: (typeof SECONDARY_NAV)[number]
}) {
  const active = isSidebarNavActive(path, to)
  return (
    <NavLink to={to} className={() => 'sb-item' + (active ? ' is-active' : '')}>
      <Icon size={16} />
      <span>{label}</span>
      {typeof count === 'number' && <span className="sb-item-count">{count}</span>}
    </NavLink>
  )
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const { pathname: path } = useLocation()
  const openComposer = useStore((s) => s.openComposer)
  const trades = useStore((s) => s.trades)
  const starredIds = useStore((s) => s.starredIds)
  const strategies = useStore((s) => s.strategies)
  const pinnedStrategyIds = useStore((s) => s.pinnedStrategyIds)

  const isPathActive = (fn: (path: string) => boolean) => fn(path)
  const sortedStrategies = sortStrategies(strategies, pinnedStrategyIds)
  const sidebarStrategies = sortedStrategies.slice(0, MAX_SIDEBAR_STRATEGIES)

  const profile = useStore((s) => s.profile)
  const isSettingsActive = path.startsWith('/settings')
  const counts = {
    all: trades.filter((trade) => trade.tradeKind !== 'paper').length,
    active: trades.filter((trade) => trade.tradeKind !== 'paper' && isActive(trade.status)).length,
    favorites: starredIds.length,
    missed: trades.filter((trade) => isMissed(trade.status)).length,
    paper: trades.filter((trade) => trade.tradeKind === 'paper').length,
  }
  const periodCount = (period: CalendarPeriod) =>
    trades.filter((trade) => trade.tradeKind !== 'paper' && tradeInPeriod(trade, period)).length

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <NavLink to="/settings/profile" className="sb-ws sb-ws-static" title="编辑个人资料">
          <UserAvatar className="sb-ws-avatar" />
          <span className="sb-ws-name">{profile.displayName}</span>
        </NavLink>
        <div className="sb-header-actions">
          <button
            type="button"
            className="sb-hbtn"
            title="搜索 (Ctrl+K)"
            aria-label="搜索 (Ctrl+K)"
            onClick={onOpenSearch}
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className="sb-hbtn"
            title="新建交易"
            aria-label="新建交易"
            onClick={() => openComposer()}
          >
            <PenSquare size={16} />
          </button>
        </div>
      </div>

      <nav className="sb-section sb-top">
        <div className="sb-section-label">工作台</div>
        {WORKBENCH_NAV.map(({ to, label, icon: Icon, active }) => (
          <NavLink
            key={to}
            to={to}
            className={() => 'sb-item' + (isPathActive(active) ? ' is-active' : '')}
          >
            <Icon size={16} />
            <span>{label}</span>
            {to === '/list' && <span className="sb-item-count">{counts.all}</span>}
          </NavLink>
        ))}
      </nav>

      <nav className="sb-section">
        <div className="sb-section-label">智能视图</div>
        {SECONDARY_NAV.map((item) => (
          <SecondaryLink
            key={item.id}
            path={path}
            item={item}
            count={counts[item.id]}
          />
        ))}
      </nav>

      <nav className="sb-section">
        <div className="sb-section-label">时间</div>
        {SIDEBAR_PERIODS.map((period) => {
          const to = `/period/${period}`
          const active = isSidebarNavActive(path, to)
          return (
            <NavLink
              key={period}
              to={to}
              className={() => 'sb-item' + (active ? ' is-active' : '')}
            >
              <CalendarDays size={16} />
              <span>{PERIOD_LABELS[period]}</span>
              <span className="sb-item-count">{periodCount(period)}</span>
            </NavLink>
          )
        })}
      </nav>

      {sidebarStrategies.length > 0 && (
        <nav className="sb-section">
          <div className="sb-section-label">策略</div>
          {sidebarStrategies.map((strategy) => {
            const to = `/strategy/${strategy.id}`
            const active = isSidebarNavActive(path, to)
            return (
              <NavLink
                key={strategy.id}
                to={to}
                className={() => 'sb-item' + (active ? ' is-active' : '')}
              >
                <StrategyIcon
                  icon={strategy.icon}
                  color={strategy.color}
                  size={14}
                  variant="nav"
                />
                <span>{strategy.name}</span>
                <span className="sb-item-count">
                  {countTradesByStrategy(trades, strategy.id)}
                </span>
              </NavLink>
            )
          })}
        </nav>
      )}

      <div className="sb-spacer" />

      <div className="sb-footer">
        <NavLink
          to="/settings"
          className={() => 'sb-item sb-settings' + (isSettingsActive ? ' is-active' : '')}
        >
          <Settings2 size={16} />
          <span>设置</span>
        </NavLink>
      </div>
    </aside>
  )
}
