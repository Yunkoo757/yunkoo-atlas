import { NavLink } from 'react-router-dom'
import {
  Search,
  PenSquare,
  ListTodo,
  LayoutGrid,
  BarChart3,
  ChevronDown,
  Settings2,
  MoreHorizontal,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '@/store/useStore'
import {
  SECONDARY_NAV,
  isSidebarNavActive,
  type SidebarNavId,
} from '@/lib/sidebarNav'
import './Sidebar.css'

const MAIN_NAV = [
  {
    to: '/list',
    label: '交易',
    icon: ListTodo,
    active: (path: string) => path === '/list',
  },
  {
    to: '/board',
    label: '看板',
    icon: LayoutGrid,
    active: (path: string) => path === '/board' || path.endsWith('/board'),
  },
  {
    to: '/dashboard',
    label: '仪表盘',
    icon: BarChart3,
    active: (path: string) => path === '/dashboard',
  },
] as const

function SecondaryLink({ id, to, label, icon: Icon }: (typeof SECONDARY_NAV)[number]) {
  const path = window.location.pathname
  const active = isSidebarNavActive(path, to)
  return (
    <NavLink key={id} to={to} className={() => 'sb-item' + (active ? ' is-active' : '')}>
      <Icon size={16} />
      <span>{label}</span>
    </NavLink>
  )
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const openComposer = useStore((s) => s.openComposer)
  const sidebarPins = useStore((s) => s.display.sidebarPins)

  const path = window.location.pathname

  const isPathActive = (fn: (path: string) => boolean) => fn(path)

  const { pinned, more } = useMemo(() => {
    const pinSet = new Set<SidebarNavId>(sidebarPins)
    const pinnedItems = SECONDARY_NAV.filter((item) => pinSet.has(item.id))
    const moreItems = SECONDARY_NAV.filter((item) => !pinSet.has(item.id))
    return { pinned: pinnedItems, more: moreItems }
  }, [sidebarPins])

  const isMoreActive = more.some((item) => isSidebarNavActive(path, item.to))
  const isSettingsActive = path.startsWith('/settings')

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <div className="sb-ws sb-ws-static" title="单用户工作区">
          <span className="sb-ws-avatar">Y</span>
          <span className="sb-ws-name">Yunkoo</span>
        </div>
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
        {MAIN_NAV.map(({ to, label, icon: Icon, active }) => (
          <NavLink
            key={to}
            to={to}
            className={() => 'sb-item' + (isPathActive(active) ? ' is-active' : '')}
          >
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
        {pinned.map((item) => (
          <SecondaryLink key={item.id} {...item} />
        ))}
      </nav>

      {more.length > 0 && (
        <div className="sb-section">
          <button
            type="button"
            className={'sb-group-label' + (isMoreActive ? ' is-active-group' : '')}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <span className="sb-group-label-inner">
              <MoreHorizontal size={12} />
              更多
            </span>
            <ChevronDown
              size={12}
              className={'sb-group-chev' + (moreOpen ? '' : ' is-closed')}
            />
          </button>
          {moreOpen && more.map((item) => <SecondaryLink key={item.id} {...item} />)}
        </div>
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
