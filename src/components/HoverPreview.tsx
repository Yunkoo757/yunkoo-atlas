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
  const suppressOpenUntilRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const [actualPlacement, setActualPlacement] = useState<Placement>(placement)

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setOpen(false)
  }

  const scheduleOpen = () => {
    if (disabled) return
    if (Date.now() < suppressOpenUntilRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(340, Math.max(260, window.innerWidth - 24))
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 12,
      )
      const nextPlacement =
        placement === 'top' && rect.top < 150 ? 'bottom' : placement
      const top =
        nextPlacement === 'bottom'
          ? rect.bottom + 10
          : rect.top - 10
      setActualPlacement(nextPlacement)
      setStyle({
        left,
        top,
        width,
        transform: nextPlacement === 'top' ? 'translateY(-100%)' : undefined,
      })
      setOpen(true)
    }, delay)
  }

  const closeForPointerAction = () => {
    suppressOpenUntilRef.current = Date.now() + 500
    close()
  }

  useEffect(() => {
    if (!open) return
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
  }, [open])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
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
      {open &&
        createPortal(
          <div
            className={'hover-preview-pop hover-preview-' + actualPlacement}
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
