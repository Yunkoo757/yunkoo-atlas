import { ICON_MD } from '@/icons/iconSize'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PanelRight, X } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import { registerShortcutHandlers } from '@/shortcuts/engine'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import './TradeDetailLayout.css'

export function TradeDetailLayout({
  sourceTradeId,
  header,
  content,
  properties,
}: {
  sourceTradeId?: string
  header: (propertiesToggle: ReactNode) => ReactNode
  content: ReactNode
  properties: ReactNode
}) {
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1200px)').matches)
  const propertiesVisible = useStore((state) => state.display.detailPropertiesVisible !== false)
  const setDisplay = useStore((state) => state.setDisplay)
  const expanded = compact ? propertiesOpen : propertiesVisible
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

  const toggleProperties = useCallback(() => {
    if (compact) setPropertiesOpen((value) => !value)
    else setDisplay({ detailPropertiesVisible: !propertiesVisible })
  }, [compact, propertiesVisible, setDisplay])

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
    <div className={'trade-detail-layout' + (!compact && !propertiesVisible ? ' is-properties-hidden' : '')} ref={layoutRef} data-source-trade-id={sourceTradeId}>
      {header(propertiesToggle)}
      <div className="dv-body">
        <section className="dv-main" aria-label="交易详情">{content}</section>
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
          {properties}
        </aside>
      </div>
    </div>
  )
}
