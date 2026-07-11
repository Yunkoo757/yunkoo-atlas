import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PanelRight, X } from 'lucide-react'
import './TradeDetailLayout.css'

export function TradeDetailLayout({
  header,
  content,
  properties,
}: {
  header: ReactNode
  content: ReactNode
  properties: ReactNode
}) {
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const propertiesId = useId()
  const layoutRef = useRef<HTMLDivElement>(null)
  const propertiesRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (!propertiesOpen) {
      if (!restoreFocusRef.current) return
      restoreFocusRef.current = false
      const frame = requestAnimationFrame(() => toggleRef.current?.focus())
      return () => cancelAnimationFrame(frame)
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

    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        restoreFocusRef.current = true
        setPropertiesOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [
        ...drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const active = document.activeElement
      if (!drawer.contains(active) || (event.shiftKey && active === first)) {
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
  }, [propertiesOpen])

  const closeProperties = () => {
    restoreFocusRef.current = true
    setPropertiesOpen(false)
  }

  return (
    <div className="trade-detail-layout" ref={layoutRef}>
      {header}
      <button
        type="button"
        className="trade-detail-properties-toggle"
        ref={toggleRef}
        onClick={() => setPropertiesOpen((value) => !value)}
        aria-controls={propertiesId}
        aria-expanded={propertiesOpen}
        aria-label={propertiesOpen ? '关闭交易属性' : '打开交易属性'}
      >
        {propertiesOpen ? <X size={16} /> : <PanelRight size={16} />}
      </button>
      <div className="dv-body">
        <main className="dv-main">{content}</main>
        {propertiesOpen && (
          <button
            type="button"
            className="trade-detail-properties-backdrop"
            aria-label="关闭交易属性"
            tabIndex={-1}
            onClick={closeProperties}
          />
        )}
        <aside
          className={'dv-props' + (propertiesOpen ? ' is-properties-open' : '')}
          id={propertiesId}
          ref={propertiesRef}
          aria-label="交易属性"
          role={propertiesOpen ? 'dialog' : undefined}
          aria-modal={propertiesOpen ? 'true' : undefined}
          tabIndex={-1}
        >
          <button
            type="button"
            className="trade-detail-properties-close"
            ref={closeRef}
            onClick={closeProperties}
            aria-label="关闭交易属性"
          >
            <X size={16} />
          </button>
          {properties}
        </aside>
      </div>
    </div>
  )
}
