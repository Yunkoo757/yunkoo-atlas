import { ICON_MD } from '@/icons/iconSize'
import { useLayoutEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { SETTINGS_NAV_GROUPS } from '@/lib/settingsNav'
import { Topbar } from '@/components/Topbar'
import './SettingsLayout.css'

export function SettingsLayout() {
  const { pathname } = useLocation()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollByPage = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel) panel.scrollTop = scrollByPage.current.get(pathname) ?? 0
  }, [pathname])

  return (
    <div className="settings-layout">
      <Topbar title="设置" titleAsHeading={false} showDisplay={false} />
      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.id} className="settings-nav-group">
              <div className="settings-nav-group-label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon }) => (
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
            </div>
          ))}
        </nav>
        <div ref={panelRef} className="settings-panel" onScroll={event => {
          scrollByPage.current.set(pathname, event.currentTarget.scrollTop)
        }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
