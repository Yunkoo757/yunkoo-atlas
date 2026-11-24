import { isComposingKey } from '@/lib/keyboardComposition'
import { ModalPortalContext, useModalPortalRegistry } from '@/components/ui/ModalShell'
import { ICON_MD } from '@/icons/iconSize'
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PanelRight, X } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import { registerShortcutHandlers } from '@/shortcuts/engine'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import './TradeDetailLayout.css'

export function TradeDetailLayout({
  header,
  content,
  properties,
  revealProperties = false,
}: {
  header: (propertiesToggle: ReactNode) => ReactNode
  content: ReactNode
  properties: ReactNode
  revealProperties?: boolean
}) {
  const [drawerOpen, setPropertiesOpen] = useState(false)
  const [temporaryReveal, setTemporaryReveal] = useState(revealProperties)
  const { portalRegistry, portalRootsRef } = useModalPortalRegistry()
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1200px)').matches)
  const propertiesVisible = useStore((state) => state.display.detailPropertiesVisible !== false)
  const setDisplay = useStore((state) => state.setDisplay)
  const propertiesOpen = compact && (drawerOpen || temporaryReveal)
  const expanded = compact ? propertiesOpen : propertiesVisible || temporaryReveal
  const propertiesHint = useShortcutHint(
    'trade.toggleProperties',
    expanded ? '关闭交易属性' : '打开交易属性',
  )
  const propertiesId = useId()
  const layoutRef = useRef<HTMLDivElement>(null)
  const propertiesRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useLayoutEffect(() => {
    if (propertiesRef.current) propertiesRef.current.inert = !expanded
  }, [expanded])

  const toggleProperties = useCallback(() => {
    setTemporaryReveal(false)
    if (compact) setPropertiesOpen(!expanded)
    else setDisplay({ detailPropertiesVisible: !expanded })
  }, [compact, expanded, setDisplay])

  useEffect(() => { setTemporaryReveal(revealProperties) }, [revealProperties])

  useEffect(() => registerShortcutHandlers({
    'trade.toggleProperties': toggleProperties,
  }), [toggleProperties])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1200px)')
    const update = () => {
      setCompact(media.matches)
      setPropertiesOpen(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (!propertiesOpen) {
      if (restoreFocusRef.current) toggleRef.current?.focus({ preventScroll: true })
      restoreFocusRef.current = false
      return
    }
    const drawer = propertiesRef.current
    const layout = layoutRef.current
    if (!drawer || !layout) return

    const backgroundElements = [
      ...layout.querySelectorAll<HTMLElement>(':scope > :not(.dv-body), .dv-main'),
    ]
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const element of backgroundElements) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }

    if (!portalRootsRef.current.size) closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposingKey(event) || document.querySelector('[data-modal-shell-id]')) return
      if (event.key === 'Escape') {
        if (portalRootsRef.current.size) return
        const target = event.target
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        restoreFocusRef.current = true
        setTemporaryReveal(false)
        setPropertiesOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const roots = [drawer, ...portalRootsRef.current]
      const focusable = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
      ))).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const active = document.activeElement
      if (!roots.some(root => root.contains(active)) || (event.shiftKey && active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      for (const { element, inert, ariaHidden } of previousBackgroundState) {
        element.inert = inert
        if (ariaHidden == null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
    }
  }, [propertiesOpen, portalRootsRef])

  const closeProperties = () => {
    restoreFocusRef.current = true
    setTemporaryReveal(false)
    setPropertiesOpen(false)
  }

  const propertiesToggle = (
        <button
          type="button"
          className="trade-detail-properties-toggle"
          ref={toggleRef}
          onClick={toggleProperties}
          aria-controls={propertiesId}
          aria-expanded={expanded}
          aria-label={propertiesHint.ariaLabel}
          {...(propertiesHint.hint ? { 'aria-keyshortcuts': propertiesHint.hint } : {})}
        >
          <PanelRight size={ICON_MD} />
          <span>属性</span>
        </button>
  )

  return (
    <div className={'trade-detail-layout' + (!compact && !expanded ? ' is-properties-hidden' : '')} ref={layoutRef}>
      {header(propertiesToggle)}
      <div className="dv-body">
        <section className="dv-main" aria-label="交易详情">{content}</section>
        {compact && (
          <button
            type="button"
            className="trade-detail-properties-backdrop"
            data-open={propertiesOpen}
            aria-hidden={!propertiesOpen}
            aria-label="关闭交易属性"
            tabIndex={-1}
            onClick={closeProperties}
          />
        )}
        <aside
          className={'dv-props' + (propertiesOpen ? ' is-properties-open' : '')}
          id={propertiesId}
          ref={propertiesRef}
          aria-hidden={!expanded}
          aria-label="交易属性"
          role={propertiesOpen ? 'dialog' : undefined}
          aria-modal={propertiesOpen ? 'true' : undefined}
          tabIndex={-1}
        >
          <Tooltip asChild content="关闭交易属性" label="关闭交易属性">
            <button
              type="button"
              className="trade-detail-properties-close"
              ref={closeRef}
              onClick={closeProperties}
              aria-label="关闭交易属性"
            >
              <X size={ICON_MD} />
            </button>
          </Tooltip>
          <ModalPortalContext.Provider value={portalRegistry}>{properties}</ModalPortalContext.Provider>
        </aside>
      </div>
    </div>
  )
}
