import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import './HoverPreview.css'

type Placement = 'top' | 'bottom'

export function HoverPreview({
  children,
  content,
  placement = 'top',
  delay = 180,
  disabled,
}: {
  children: ReactNode
  content: ReactNode
  placement?: Placement
  delay?: number
  disabled?: boolean
}) {
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
    }, 80)
  }

  const scheduleOpen = () => {
    if (disabled) return
    if (Date.now() < suppressOpenUntilRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(336, Math.max(260, window.innerWidth - 24))
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 12,
      )
      const nextPlacement =
        placement === 'top' && rect.top < 150 ? 'bottom' : placement
      const top =
        nextPlacement === 'bottom'
          ? rect.bottom + 8
          : rect.top - 8
      setActualPlacement(nextPlacement)
      setStyle({
        left,
        top,
        width,
      })
      setRendered(true)
      frameRef.current = requestAnimationFrame(() => {
        setVisible(true)
        frameRef.current = null
      })
    }, delay)
  }

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
        onMouseEnter={scheduleOpen}
        onMouseLeave={close}
        onMouseDown={closeForPointerAction}
        onFocus={scheduleOpen}
        onBlur={close}
      >
        {children}
      </span>
      {rendered &&
        createPortal(
          <div
            className={'hover-preview-pop hover-preview-' + actualPlacement}
            data-state={visible ? 'open' : 'closed'}
            style={style}
            role="tooltip"
          >
            {content}
          </div>,
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
