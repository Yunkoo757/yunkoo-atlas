import { NavLink } from 'react-router-dom'
import {
  Search,
  PenSquare,
  Inbox,
  Target,
  ListTodo,
  LayoutGrid,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Box,
  MoreHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/store/useStore'
import './Sidebar.css'

const NAV = [
  { to: '/list', label: '交易', icon: ListTodo },
  { to: '/board', label: '看板', icon: LayoutGrid },
  { to: '/dashboard', label: '仪表盘', icon: BarChart3 },
]

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [favOpen, setFavOpen] = useState(true)
  const [wsOpen, setWsOpen] = useState(true)
  const openComposer = useStore((s) => s.openComposer)

  return (
    <aside className="sidebar">
      {/* 工作区头：头像 + 名称 + 搜索/撰写 */}
      <div className="sb-header">
        <button className="sb-ws">
          <span className="sb-ws-avatar">Y</span>
          <span className="sb-ws-name">Yunkoo</span>
          <ChevronDown size={14} className="sb-ws-chevron" />
        </button>
        <div className="sb-header-actions">
          <button className="sb-hbtn" title="搜索 (Ctrl+K)" onClick={onOpenSearch}>
            <Search size={16} />
          </button>
          <button className="sb-hbtn" title="新建交易" onClick={() => openComposer()}>
            <PenSquare size={16} />
          </button>
        </div>
      </div>

      {/* 置顶项 */}
      <nav className="sb-section sb-top">
        <button className="sb-item">
          <Inbox size={16} />
          <span>收件箱</span>
        </button>
        <button className="sb-item">
          <Target size={16} />
          <span>我的交易</span>
        </button>
      </nav>

      {/* 工作区分组 */}
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
              className={({ isActive }) =>
                'sb-item' + (isActive ? ' is-active' : '')
              }
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        {wsOpen && (
          <button className="sb-item">
            <MoreHorizontal size={16} />
            <span>更多</span>
          </button>
        )}
      </div>

      {/* 收藏分组 */}
      <div className="sb-section">
        <button className="sb-group-label" onClick={() => setFavOpen((o) => !o)}>
          <span>收藏</span>
          <ChevronDown
            size={12}
            className={'sb-group-chev' + (favOpen ? '' : ' is-closed')}
          />
        </button>
        {favOpen &&
          ['Breakout 策略', 'Trend Following', 'Mean Reversion'].map((s) => (
            <button className="sb-item" key={s}>
              <Box size={16} />
              <span>{s}</span>
            </button>
          ))}
      </div>

      {/* 团队（折叠占位）*/}
      <div className="sb-section">
        <button className="sb-group-label">
          <span>我的团队</span>
          <ChevronRight size={12} className="sb-group-chev" />
        </button>
      </div>
    </aside>
  )
}
