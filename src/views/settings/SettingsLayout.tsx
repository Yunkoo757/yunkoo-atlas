import { ICON_MD } from '@/icons/iconSize'
import { useLayoutEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { SETTINGS_NAV } from '@/lib/settingsNav'
import { Topbar } from '@/components/Topbar'
import './SettingsLayout.css'

export function SettingsLayout() {
  const { pathname } = useLocation()
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
  }, [pathname])

  return (
    <div className="settings-layout">
      <Topbar title="设置" titleAsHeading={false} showDisplay={false} />
      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {SETTINGS_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              className={({ isActive }) => 'settings-nav-item' + (isActive ? ' is-active' : '')}
            >
              <Icon size={ICON_MD} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div ref={panelRef} className="settings-panel">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
