import { useRef, useState } from 'react'
import { Menu, Search, Settings2, Trash2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { PRIMARY_NAV } from '@/lib/sidebarNav'
import { workspaceRouteHref } from '@/lib/workspaceViews'
import { WORKSPACE_ICONS, useSidebarNavigationModel } from '@/components/Sidebar'
import { SidebarWorkspaceEditor } from '@/components/sidebar/SidebarWorkspaceEditor'
import './MobileNavigation.css'

const MOBILE_LABELS = {
  today: '今日',
  trades: '交易',
  reviewCases: '案例',
  dashboard: '仪表盘',
} as const

export function MobileNavigation({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const {
    path,
    strategies,
    sidebarWorkspaceItems,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    workspaceItems,
    selection,
    primaryHref,
  } = useSidebarNavigationModel()

  const returnFocusToMore = () => {
    requestAnimationFrame(() => moreButtonRef.current?.focus())
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    returnFocusToMore()
  }
  const closeEditor = () => {
    setEditorOpen(false)
    returnFocusToMore()
  }

  return (
    <>
      <nav className="mobile-navigation" aria-label="移动导航">
        {PRIMARY_NAV.map(({ id, to, icon: Icon }) => {
          const active = selection.activePrimaryId === id
          const label = MOBILE_LABELS[id]
          return (
            <NavLink
              key={id}
              to={primaryHref(id, to)}
              className={`mobile-navigation-action${active ? ' is-active' : ''}`}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          )
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={`mobile-navigation-action${drawerOpen || editorOpen ? ' is-active' : ''}`}
          aria-label="更多"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
          <span>更多</span>
        </button>
      </nav>

      {drawerOpen ? (
        <div className="mobile-navigation-overlay">
          <button className="mobile-navigation-backdrop" type="button" aria-label="关闭更多" onClick={closeDrawer} />
          <section className="mobile-navigation-drawer" role="dialog" aria-label="更多">
            <header>
              <h2>更多</h2>
              <button type="button" aria-label="关闭更多" onClick={closeDrawer}>关闭</button>
            </header>
            <nav aria-label="我的空间">
              {workspaceItems.map((item) => {
                const Icon = WORKSPACE_ICONS[item.icon]
                const active = selection.activeWorkspaceItemId === item.item.id
                return (
                  <NavLink
                    key={item.item.id}
                    to={workspaceRouteHref(item)}
                    data-mobile-workspace-item
                    className={active ? 'is-active' : undefined}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
            <nav className="mobile-navigation-utilities" aria-label="辅助导航">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false)
                  onOpenSearch?.()
                }}
              >
                <Search size={18} aria-hidden="true" />
                <span>搜索</span>
              </button>
              <NavLink to="/settings" className={path.startsWith('/settings') ? 'is-active' : undefined} onClick={() => setDrawerOpen(false)}>
                <Settings2 size={18} aria-hidden="true" />
                <span>设置</span>
              </NavLink>
              <NavLink to="/trade-trash" className={path === '/trade-trash' ? 'is-active' : undefined} onClick={() => setDrawerOpen(false)}>
                <Trash2 size={18} aria-hidden="true" />
                <span>回收站</span>
              </NavLink>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false)
                  setEditorOpen(true)
                }}
              >
                <Menu size={18} aria-hidden="true" />
                <span>管理我的空间</span>
              </button>
            </nav>
          </section>
        </div>
      ) : null}

      {editorOpen ? (
        <SidebarWorkspaceEditor
          variant="mobile-fullscreen"
          items={sidebarWorkspaceItems}
          sources={{ savedViews: savedTradeViews, strategies }}
          onCommit={(items) => {
            replaceSidebarWorkspaceItems(items)
            closeEditor()
          }}
          onCancel={closeEditor}
        />
      ) : null}
    </>
  )
}
