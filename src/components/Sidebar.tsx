import { NavLink, useNavigate } from 'react-router-dom'
import {
  Search,
  PenSquare,
  Inbox,
  Target,
  ListTodo,
  LayoutGrid,
  BarChart3,
  ChevronDown,
  Settings2,
  Star,
  HardDriveDownload,
  Calendar,
  Ban,
  FileEdit,
  GraduationCap,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useStore } from '@/store/useStore'
import { StrategyIcon } from '@/components/StrategyIcon'
import { sortStrategies } from '@/lib/strategies'
import { CALENDAR_PERIODS, PERIOD_LABELS } from '@/lib/periods'
import './Sidebar.css'

const NAV = [
  { to: '/list', label: '交易', icon: ListTodo },
  { to: '/board', label: '看板', icon: LayoutGrid },
  { to: '/dashboard', label: '仪表盘', icon: BarChart3 },
]

export function Sidebar({
  onOpenSearch,
  onOpenDataIO,
}: {
  onOpenSearch?: () => void
  onOpenDataIO?: () => void
}) {
  const [favOpen, setFavOpen] = useState(true)
  const [wsOpen, setWsOpen] = useState(true)
  const [timeOpen, setTimeOpen] = useState(false)
  const [simOpen, setSimOpen] = useState(false)
  const openComposer = useStore((s) => s.openComposer)
  const strategies = useStore((s) => s.strategies)
  const pinnedStrategyIds = useStore((s) => s.pinnedStrategyIds)
  const sortedStrategies = useMemo(
    () => sortStrategies(strategies, pinnedStrategyIds),
    [strategies, pinnedStrategyIds],
  )
  const navigate = useNavigate()

  const isActive = (to: string) => {
    const path = window.location.pathname
    if (to === '/list') {
      return path === '/list' || path === '/board'
    }
    return path === to || path.startsWith(to + '/')
  }

  const isPeriodActive = (slug: string) => {
    const path = window.location.pathname
    return path === `/period/${slug}` || path === `/period/${slug}/board`
  }

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <div className="sb-ws sb-ws-static" title="单用户工作区">
          <span className="sb-ws-avatar">Y</span>
          <span className="sb-ws-name">Yunkoo</span>
        </div>
        <div className="sb-header-actions">
          <button className="sb-hbtn" title="搜索 (Ctrl+K)" onClick={onOpenSearch}>
            <Search size={16} />
          </button>
          <button className="sb-hbtn" title="新建交易" onClick={() => openComposer()}>
            <PenSquare size={16} />
          </button>
        </div>
      </div>

      <nav className="sb-section sb-top">
        <NavLink to="/inbox" className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}>
          <Inbox size={16} />
          <span>收件箱</span>
        </NavLink>
        <NavLink
          to="/my-trades"
          className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}
        >
          <Target size={16} />
          <span>我的交易</span>
        </NavLink>
        <NavLink
          to="/favorites"
          className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}
        >
          <Star size={16} />
          <span>星标交易</span>
        </NavLink>
        <NavLink
          to="/missed"
          className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}
        >
          <Ban size={16} />
          <span>错过的机会</span>
        </NavLink>
      </nav>

      <div className="sb-section">
        <button className="sb-group-label" onClick={() => setTimeOpen((o) => !o)}>
          <span>时间</span>
          <ChevronDown
            size={12}
            className={'sb-group-chev' + (timeOpen ? '' : ' is-closed')}
          />
        </button>
        {timeOpen &&
          CALENDAR_PERIODS.map((slug) => (
            <button
              key={slug}
              className={'sb-item' + (isPeriodActive(slug) ? ' is-active' : '')}
              onClick={() => navigate(`/period/${slug}`)}
            >
              <Calendar size={16} />
              <span>{PERIOD_LABELS[slug]}</span>
            </button>
          ))}
      </div>

      <div className="sb-section">
        <button className="sb-group-label" onClick={() => setSimOpen((o) => !o)}>
          <span>模拟</span>
          <ChevronDown
            size={12}
            className={'sb-group-chev' + (simOpen ? '' : ' is-closed')}
          />
        </button>
        {simOpen && (
          <>
            <NavLink
              to="/paper"
              className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}
            >
              <FileEdit size={16} />
              <span>纸面</span>
            </NavLink>
            <NavLink
              to="/practice"
              className={({ isActive: a }) => 'sb-item' + (a ? ' is-active' : '')}
            >
              <GraduationCap size={16} />
              <span>练习复盘</span>
            </NavLink>
          </>
        )}
      </div>

      <div className="sb-section">
        <button className="sb-group-label" onClick={() => setWsOpen((o) => !o)}>
          <span>工作区</span>
          <ChevronDown
            size={12}
            className={'sb-group-chev' + (wsOpen ? '' : ' is-closed')}
          />
        </button>
        {wsOpen &&
          NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={() => 'sb-item' + (isActive(to) ? ' is-active' : '')}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        {wsOpen && (
          <button className="sb-item" onClick={onOpenDataIO}>
            <HardDriveDownload size={16} />
            <span>导入/导出数据</span>
          </button>
        )}
      </div>

      <div className="sb-section">
        <button className="sb-group-label" onClick={() => setFavOpen((o) => !o)}>
          <span>策略</span>
          <ChevronDown
            size={12}
            className={'sb-group-chev' + (favOpen ? '' : ' is-closed')}
          />
        </button>
        {favOpen &&
          sortedStrategies.map((s) => (
            <button
              className={
                'sb-item' +
                (window.location.pathname.startsWith(`/strategy/${s.id}`) ? ' is-active' : '')
              }
              key={s.id}
              onClick={() => navigate(`/strategy/${s.id}`)}
            >
              <StrategyIcon icon={s.icon} color={s.color} size={16} variant="nav" />
              <span>{s.name}</span>
            </button>
          ))}
        {favOpen && (
          <button
            className={
              'sb-item sb-item-ghost' +
              (window.location.pathname === '/strategies' ? ' is-active' : '')
            }
            onClick={() => navigate('/strategies')}
          >
            <Settings2 size={16} />
            <span>管理策略…</span>
          </button>
        )}
      </div>
    </aside>
  )
}
