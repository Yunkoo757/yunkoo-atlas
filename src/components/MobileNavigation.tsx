import { useEffect, useRef, useState, type RefObject } from 'react'
import { Menu, Search, Settings2, Trash2 } from '@/icons/appIcons'
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
  weeklyReview: '周复盘',
  reviewSession: '复盘',
  dashboard: '仪表盘',
} as const

const MOBILE_PRIMARY_NAV = PRIMARY_NAV.filter((item) => item.id !== 'reviewSession' && item.id !== 'weeklyReview')
const WEEKLY_REVIEW_NAV = PRIMARY_NAV.find((item) => item.id === 'weeklyReview')
const REVIEW_SESSION_NAV = PRIMARY_NAV.find((item) => item.id === 'reviewSession')

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function useMobileModal({
  open,
  modalRef,
  onClose,
}: {
  open: boolean
  modalRef: RefObject<HTMLElement>
  onClose: () => void
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const modal = modalRef.current
    if (!modal) return

    const backgroundElements = [
      document.querySelector<HTMLElement>('.ui-main-frame'),
      document.querySelector<HTMLElement>('.mobile-navigation'),
    ].filter((element): element is HTMLElement => Boolean(element))
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const element of backgroundElements) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = requestAnimationFrame(() => {
      if (modal.contains(document.activeElement)) return
      const initial = modal.querySelector<HTMLElement>('[data-modal-initial-focus]')
        ?? [...modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
          .find((element) => element.getClientRects().length > 0)
      ;(initial ?? modal).focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        modal.focus()
        return
      }
      const active = document.activeElement
      if (!modal.contains(active) || (event.shiftKey && active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousBodyOverflow
      for (const { element, inert, ariaHidden } of previousBackgroundState) {
        element.inert = inert
        if (ariaHidden == null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
    }
  }, [open, modalRef])
}

export function MobileNavigation({
  onOpenSearch,
}: {
  onOpenSearch?: (returnFocusTo?: HTMLElement | null) => void
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const editorModalRef = useRef<HTMLDivElement>(null)
  const locationRef = useRef('')
  const restoreMoreFocusRef = useRef(false)
  const {
    path,
    search,
    strategies,
    sidebarWorkspaceItems,
    savedTradeViews,
    replaceSidebarWorkspaceItems,
    workspaceItems,
    selection,
    primaryHref,
  } = useSidebarNavigationModel()

  const closeDrawer = () => {
    if (!drawerOpen) return
    restoreMoreFocusRef.current = true
    setDrawerOpen(false)
  }
  const closeEditor = () => {
    restoreMoreFocusRef.current = true
    setEditorOpen(false)
  }
  useMobileModal({ open: drawerOpen, modalRef: drawerRef, onClose: closeDrawer })
  useMobileModal({ open: editorOpen, modalRef: editorModalRef, onClose: closeEditor })

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)')
    const closeModalsOnDesktop = () => {
      if (!desktop.matches) return
      restoreMoreFocusRef.current = false
      setDrawerOpen(false)
      setEditorOpen(false)
    }
    closeModalsOnDesktop()
    desktop.addEventListener('change', closeModalsOnDesktop)
    return () => desktop.removeEventListener('change', closeModalsOnDesktop)
  }, [])

  useEffect(() => {
    if (drawerOpen || editorOpen || !restoreMoreFocusRef.current) return
    restoreMoreFocusRef.current = false
    const frame = requestAnimationFrame(() => moreButtonRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [drawerOpen, editorOpen])

  useEffect(() => {
    const location = `${path}${search}`
    if (!locationRef.current) {
      locationRef.current = location
      return
    }
    if (locationRef.current === location) return
    locationRef.current = location
    if (drawerOpen) closeDrawer()
  }, [path, search, drawerOpen])

  return (
    <>
      <nav className="mobile-navigation" aria-label="移动导航">
        {MOBILE_PRIMARY_NAV.map(({ id, to, icon: Icon }) => {
          const active = selection.activePrimaryId === id
          const label = MOBILE_LABELS[id]
          return (
            <NavLink
              key={id}
              to={primaryHref(id, to)}
              className={`mobile-navigation-action${active ? ' is-active' : ''}`}
              aria-label={label}
              aria-current={active ? 'page' : 'false'}
              onClick={closeDrawer}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          )
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={`mobile-navigation-action${drawerOpen ? ' is-open' : ''}${selection.activePrimaryId === 'reviewSession' || selection.activePrimaryId === 'weeklyReview' ? ' is-active' : ''}`}
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
          <button className="mobile-navigation-backdrop" type="button" tabIndex={-1} aria-label="关闭更多" onClick={closeDrawer} />
          <section ref={drawerRef} className="mobile-navigation-drawer" role="dialog" aria-modal="true" aria-label="更多" tabIndex={-1}>
            <header>
              <h2>更多</h2>
              <button type="button" data-modal-initial-focus aria-label="关闭更多" onClick={closeDrawer}>关闭</button>
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
                    data-mobile-drawer-item
                    className={active ? 'is-active' : undefined}
                    aria-current={active ? 'page' : undefined}
                    onClick={closeDrawer}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
            <nav className="mobile-navigation-utilities" aria-label="辅助导航">
              {WEEKLY_REVIEW_NAV ? (
                <NavLink
                  to={primaryHref(WEEKLY_REVIEW_NAV.id, WEEKLY_REVIEW_NAV.to)}
                  data-mobile-drawer-item
                  className={selection.activePrimaryId === WEEKLY_REVIEW_NAV.id ? 'is-active' : undefined}
                  aria-current={selection.activePrimaryId === WEEKLY_REVIEW_NAV.id ? 'page' : undefined}
                  onClick={closeDrawer}
                >
                  <WEEKLY_REVIEW_NAV.icon size={18} aria-hidden="true" />
                  <span>{WEEKLY_REVIEW_NAV.label}</span>
                </NavLink>
              ) : null}
              {REVIEW_SESSION_NAV ? (
                <NavLink
                  to={primaryHref(REVIEW_SESSION_NAV.id, REVIEW_SESSION_NAV.to)}
                  data-mobile-drawer-item
                  className={selection.activePrimaryId === REVIEW_SESSION_NAV.id ? 'is-active' : undefined}
                  aria-current={selection.activePrimaryId === REVIEW_SESSION_NAV.id ? 'page' : undefined}
                  onClick={closeDrawer}
                >
                  <REVIEW_SESSION_NAV.icon size={18} aria-hidden="true" />
                  <span>{REVIEW_SESSION_NAV.label}</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                data-mobile-drawer-item
                onClick={() => {
                  restoreMoreFocusRef.current = false
                  setDrawerOpen(false)
                  requestAnimationFrame(() => {
                    onOpenSearch?.(moreButtonRef.current)
                  })
                }}
              >
                <Search size={18} aria-hidden="true" />
                <span>搜索</span>
              </button>
              <NavLink
                to="/settings"
                data-mobile-drawer-item
                className={path.startsWith('/settings') ? 'is-active' : undefined}
                aria-current={path.startsWith('/settings') ? 'page' : undefined}
                onClick={closeDrawer}
              >
                <Settings2 size={18} aria-hidden="true" />
                <span>设置</span>
              </NavLink>
              <NavLink
                to="/trade-trash"
                data-mobile-drawer-item
                className={path === '/trade-trash' ? 'is-active' : undefined}
                aria-current={path === '/trade-trash' ? 'page' : undefined}
                onClick={closeDrawer}
              >
                <Trash2 size={18} aria-hidden="true" />
                <span>回收站</span>
              </NavLink>
              <button
                type="button"
                data-mobile-drawer-item
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
        <div ref={editorModalRef} className="mobile-navigation-editor-host">
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
        </div>
      ) : null}
    </>
  )
}
