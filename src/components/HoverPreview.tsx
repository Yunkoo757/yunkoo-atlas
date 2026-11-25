import { PopoverSurface } from '@/components/ui/PopoverSurface'
import { motionDuration, reducesMotion } from '@/lib/motion'
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import './HoverPreview.css'

type Placement = 'top' | 'bottom'

const DEFAULT_PREVIEW_DELAY_MS = 500

export function HoverPreview({
  children,
  content,
  placement = 'top',
  delay = DEFAULT_PREVIEW_DELAY_MS,
  compact = false,
  disabled,
}: {
  children: ReactNode
  content: ReactNode
  placement?: Placement
  delay?: number
  compact?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<number | null>(null)
  const suppressOpenUntilRef = useRef(0)
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const [actualPlacement, setActualPlacement] = useState<Placement>(placement)

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setVisible(false)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setRendered(false)
      closeTimerRef.current = null
    }, reducesMotion() ? 0 : motionDuration(document.documentElement, '--motion-menu'))
  }

  const scheduleOpen = (wait: number) => {
    if (disabled) return
    if (Date.now() < suppressOpenUntilRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    timerRef.current = setTimeout(() => {
      setRendered(true)
      frameRef.current = requestAnimationFrame(() => {
        setVisible(true)
        frameRef.current = null
      })
    }, wait)
  }

  useLayoutEffect(() => {
    if (!rendered) return
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return

    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const inset = 8
      const gap = 6
      const above = rect.top - inset - gap
      const below = window.innerHeight - rect.bottom - inset - gap
      const preferredRoom = placement === 'top' ? above : below
      const alternateRoom = placement === 'top' ? below : above
      const side = panel.offsetHeight > preferredRoom && alternateRoom > preferredRoom
        ? (placement === 'top' ? 'bottom' : 'top')
        : placement
      const left = Math.max(inset, Math.min(rect.left, window.innerWidth - panel.offsetWidth - inset))
      const preferredTop = side === 'top' ? rect.top - gap - panel.offsetHeight : rect.bottom + gap
      const top = Math.max(inset, Math.min(preferredTop, window.innerHeight - panel.offsetHeight - inset))
      setActualPlacement(side)
      setStyle({ left, top })
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    observer.observe(trigger)
    return () => observer.disconnect()
  }, [rendered, placement])

  const schedulePointerOpen = () => scheduleOpen(delay)
  const openFromFocus = () => scheduleOpen(0)

  const closeForPointerAction = () => {
    suppressOpenUntilRef.current = Date.now() + 500
    close()
  }

  useEffect(() => {
    if (!rendered) return
    const onScroll = () => close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [rendered])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  return (
    <>
      <span
        className="hover-preview-anchor"
        ref={triggerRef}
        onMouseEnter={schedulePointerOpen}
        onMouseLeave={close}
        onMouseDown={closeForPointerAction}
        onFocus={openFromFocus}
        onBlur={close}
      >
        {rendered && isValidElement<{ 'aria-describedby'?: string }>(children)
          ? cloneElement(children, {
            'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
          })
          : children}
      </span>
      {rendered &&
        createPortal(
          <PopoverSurface
            ref={panelRef}
            id={id}
            kind="tooltip"
            data-compact={compact || undefined}
            className={'hover-preview-pop hover-preview-' + actualPlacement}
            data-state={visible ? 'open' : 'closed'}
            style={style}
            role="tooltip"
          >
            {content}
          </PopoverSurface>,
          document.body,
        )}
    </>
  )
}

export function PreviewHeader({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <div className="hp-head">
      {icon && <span className="hp-head-icon">{icon}</span>}
      <div className="hp-head-text">
        <span className="hp-title">{title}</span>
        {subtitle && <span className="hp-subtitle">{subtitle}</span>}
      </div>
    </div>
  )
}

export function PreviewMeta({
  children,
}: {
  children: ReactNode
}) {
  return <div className="hp-meta">{children}</div>
}
