import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import {
  Search,
  PenSquare,
  ListTodo,
  BarChart3,
  CalendarDays,
  Settings2,
  Trash2,
  BookOpen,
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
import type { CaseRecord, DisputeType } from '@/data/case'
import { deriveLifecycle, isDeleted } from '@/data/case'
import './Sidebar.css'

const WORKBENCH_NAV = [
  {
    to: '/list',
    label: '交易',
    icon: ListTodo,
    active: (path: string) => path === '/list' || path === '/board',
  },
  {
    to: '/review-cases',
    label: '案例记录',
    icon: BookOpen,
    active: (path: string) => path.startsWith('/review-cases'),
  },
  {
    to: '/dashboard',
    label: '仪表盘',
    icon: BarChart3,
    active: (path: string) => path === '/dashboard',
  },
] as const

const SIDEBAR_PERIODS: CalendarPeriod[] = CALENDAR_PERIODS
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
  const { pathname: path, search } = useLocation()
  const navigate = useNavigate()
  const openComposer = useStore((s) => s.openComposer)
  const setCaseModalOpen = useStore((s) => s.setCaseModalOpen)
  const trades = useStore((s) => s.trades)
  const starredIds = useStore((s) => s.starredIds)
  const strategies = useStore((s) => s.strategies)
  const pinnedStrategyIds = useStore((s) => s.pinnedStrategyIds)
  const activeModule = useStore((s) => s.activeModule)
  const setModule = useStore((s) => s.setModule)
  const cases = useStore((s) => s.cases)
  const disputeTypes = useStore((s) => s.disputeTypes)

  const isPathActive = (fn: (path: string) => boolean) => fn(path)
  const sortedStrategies = sortStrategies(strategies, pinnedStrategyIds)
  const sidebarStrategies = sortedStrategies.slice(0, MAX_SIDEBAR_STRATEGIES)

  useEffect(() => {
    const nextModule = path.startsWith('/cases') ? 'case' : 'trade'
    if (activeModule !== nextModule) setModule(nextModule)
  }, [activeModule, path, setModule])

  const profile = useStore((s) => s.profile)
  const isSettingsActive = path.startsWith('/settings')
  const activeTrades = trades.filter((t) => !t.deletedAt)
  const trashTrades = trades.filter((t) => t.deletedAt)
  const liveTrades = activeTrades.filter((trade) => trade.tradeKind === 'live')
  const accountTrades = activeTrades.filter((trade) => trade.tradeKind !== 'case')
  const reviewCaseTrades = activeTrades.filter((trade) => trade.tradeKind === 'case')
  const counts = {
    all: liveTrades.length,
    reviewCases: reviewCaseTrades.length,
    reviewFocus: reviewCaseTrades.filter((trade) => trade.reviewStatus === 'focus').length,
    reviewMistakes: reviewCaseTrades.filter((trade) => trade.status === 'missed' || trade.mistakeTags.length > 0).length,
    reviewUnreviewed: reviewCaseTrades.filter((trade) => trade.reviewStatus === 'unreviewed').length,
    reviewReviewed: reviewCaseTrades.filter((trade) => trade.reviewStatus === 'reviewed').length,
    active: liveTrades.filter((trade) => isActive(trade.status)).length,
    favorites: accountTrades.filter((trade) => starredIds.includes(trade.id)).length,
    missed: accountTrades.filter((trade) => isMissed(trade.status)).length,
    paper: activeTrades.filter((trade) => trade.tradeKind === 'paper').length,
  }
  const periodCount = (period: CalendarPeriod) =>
    liveTrades.filter((trade) => tradeInPeriod(trade, period)).length

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
            title={activeModule === 'case' ? '新建判例' : path.startsWith('/review-cases') ? '新建案例记录' : '新建交易'}
            aria-label={activeModule === 'case' ? '新建判例' : path.startsWith('/review-cases') ? '新建案例记录' : '新建交易'}
            onClick={() => {
              if (activeModule === 'case') setCaseModalOpen(true)
              else openComposer()
            }}
          >
            <PenSquare size={16} />
          </button>
        </div>
      </div>

      {/* 模块切换器 — 独立分段 */}
      <div className="sb-module-switch">
        <div className="sb-module-switch-inner">
          <button
            type="button"
            className={'sb-module-tab' + (activeModule === 'trade' ? ' is-active' : '')}
            onClick={() => { setModule('trade'); navigate('/list') }}
          >
            复盘
          </button>
          <button
            type="button"
            className={'sb-module-tab' + (activeModule === 'case' ? ' is-active' : '')}
            onClick={() => { setModule('case'); navigate('/cases') }}
          >
            判例
          </button>
        </div>
      </div>

      {activeModule === 'trade' && (
        <>
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
            {to === '/review-cases' && <span className="sb-item-count">{counts.reviewCases}</span>}
          </NavLink>
        ))}
      </nav>

      <nav className="sb-section">
        <div className="sb-section-label">案例记录</div>
        {[
          { to: '/review-cases', label: '全部', count: counts.reviewCases },
          { to: '/review-cases/focus', label: '重点', count: counts.reviewFocus },
          { to: '/review-cases/mistakes', label: '错题', count: counts.reviewMistakes },
          { to: '/review-cases/unreviewed', label: '待复看', count: counts.reviewUnreviewed },
          { to: '/review-cases/reviewed', label: '已掌握', count: counts.reviewReviewed },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={() => 'sb-item' + (path === item.to || path === `${item.to}/board` ? ' is-active' : '')}
          >
            <span>{item.label}</span>
            <span className="sb-item-count">{item.count}</span>
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
                  {countTradesByStrategy(accountTrades, strategy.id)}
                </span>
              </NavLink>
            )
          })}
        </nav>
      )}
      <nav className="sb-section">
        <NavLink
          to="/trade-trash"
          className={() => 'sb-item sb-trash' + (path === '/trade-trash' ? ' is-active' : '')}
        >
          <Trash2 size={16} />
          <span>回收站</span>
          {trashTrades.length > 0 && (
            <span className="sb-item-count">{trashTrades.length}</span>
          )}
        </NavLink>
      </nav>
        </>
      )}

      {activeModule === 'case' && (
        <CaseNav cases={cases} disputeTypes={disputeTypes} path={path} search={search} />
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

function CaseNav({
  cases,
  disputeTypes,
  path,
  search,
}: {
  cases: CaseRecord[]
  disputeTypes: DisputeType[]
  path: string
  search: string
}) {
  const query = new URLSearchParams(search)
  const activeCases = cases.filter((c) => !isDeleted(c))
  const trashCases = cases.filter((c) => isDeleted(c))
  const pending = activeCases.filter((c) => deriveLifecycle(c) === '待验证').length
  const decided = activeCases.filter((c) => deriveLifecycle(c) === '已裁决').length
  const discarded = activeCases.filter((c) => deriveLifecycle(c) === '已废弃').length
  const starred = activeCases.filter((c) => c.star).length
  const recheck = activeCases.filter((c) => c.recheck).length

  return (
    <>
      <nav className="sb-section">
        <div className="sb-section-label">生命周期</div>
        <NavLink
          to="/cases"
          className={() => 'sb-item' + (path === '/cases' && !search ? ' is-active' : '')}
        >
          <span>全部</span>
          <span className="sb-item-count">{activeCases.length}</span>
        </NavLink>
        <NavLink
          to="/cases?lifecycle=待验证"
          className={() => 'sb-item' + (query.get('lifecycle') === '待验证' ? ' is-active' : '')}
        >
          <span>待验证</span>
          <span className="sb-item-count">{pending}</span>
        </NavLink>
        <NavLink
          to="/cases?lifecycle=已裁决"
          className={() => 'sb-item' + (query.get('lifecycle') === '已裁决' ? ' is-active' : '')}
        >
          <span>已裁决</span>
          <span className="sb-item-count">{decided}</span>
        </NavLink>
        <NavLink
          to="/cases?lifecycle=已废弃"
          className={() => 'sb-item' + (query.get('lifecycle') === '已废弃' ? ' is-active' : '')}
        >
          <span>已废弃</span>
          <span className="sb-item-count">{discarded}</span>
        </NavLink>
      </nav>
      <nav className="sb-section">
        <div className="sb-section-label">标志</div>
        <NavLink
          to="/cases?star=true"
          className={() => 'sb-item' + (query.get('star') === 'true' ? ' is-active' : '')}
        >
          <span>典型案例</span>
          <span className="sb-item-count">{starred}</span>
        </NavLink>
        <NavLink
          to="/cases?recheck=true"
          className={() => 'sb-item' + (query.get('recheck') === 'true' ? ' is-active' : '')}
        >
          <span>需要复看</span>
          <span className="sb-item-count">{recheck}</span>
        </NavLink>
      </nav>
      {disputeTypes.length > 0 && (
        <nav className="sb-section">
          <div className="sb-section-label">纠纷类型</div>
          {disputeTypes.slice(0, 6).map((dt) => {
            const count = activeCases.filter((c) => c.disputeTypeId === dt.id).length
            if (count === 0) return null
            return (
              <NavLink
                key={dt.id}
                to={`/cases?disputeType=${dt.id}`}
                className={() => 'sb-item' + (query.get('disputeType') === dt.id ? ' is-active' : '')}
              >
                <span>{dt.name}</span>
                <span className="sb-item-count">{count}</span>
              </NavLink>
            )
          })}
        </nav>
      )}
      <nav className="sb-section">
        <NavLink
          to="/trash"
          className={() => 'sb-item sb-trash' + (path === '/trash' ? ' is-active' : '')}
        >
          <Trash2 size={16} />
          <span>回收站</span>
          {trashCases.length > 0 && (
            <span className="sb-item-count">{trashCases.length}</span>
          )}
        </NavLink>
      </nav>
    </>
  )
}
