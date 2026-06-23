import { NavLink, Outlet } from 'react-router-dom'
import { Keyboard, SlidersHorizontal, HardDriveDownload, Settings2, UserCircle, Tag, Gavel } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import './SettingsLayout.css'

const NAV = [
  { to: '/settings/profile', label: '资料', icon: UserCircle },
  { to: '/settings/shortcuts', label: '快捷键', icon: Keyboard },
  { to: '/settings/strategies', label: '策略', icon: Settings2 },
  { to: '/settings/tags', label: '标签', icon: Tag },
  { to: '/settings/dispute-types', label: '纠纷', icon: Gavel },
  { to: '/settings/display', label: '显示', icon: SlidersHorizontal },
  { to: '/settings/data', label: '数据', icon: HardDriveDownload },
] as const

export function SettingsLayout() {
  return (
    <div className="settings-layout">
      <Topbar title="设置" showDisplay={false} />
      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => 'settings-nav-item' + (isActive ? ' is-active' : '')}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="settings-panel">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
