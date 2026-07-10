import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

type TooltipPosition = {
  left: number
  top: number
  placement: 'top' | 'bottom'
}

export function Tooltip({
  children,
  content,
  label,
  delay = 160,
  focusable = false,
}: {
  children: ReactNode
  content: ReactNode
  label: string
  delay?: number
  focusable?: boolean
}) {
  const id = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement: 'top',
  })

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setOpen(false)
  }

  const scheduleOpen = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const placement = rect.top > 48 ? 'top' : 'bottom'
      setPosition({
        left: rect.left + rect.width / 2,
        top: placement === 'top' ? rect.top - 6 : rect.bottom + 6,
        placement,
      })
      setOpen(true)
    }, delay)
  }

  useLayoutEffect(() => {
    if (!open) return
    const tooltip = tooltipRef.current
    const trigger = triggerRef.current
    if (!tooltip || !trigger) return
    const tooltipWidth = tooltip.getBoundingClientRect().width
    const triggerRect = trigger.getBoundingClientRect()
    const edge = 8 + tooltipWidth / 2
    const left = Math.min(
      Math.max(edge, triggerRect.left + triggerRect.width / 2),
      window.innerWidth - edge,
    )
    setPosition((current) => (Math.abs(current.left - left) < 0.5 ? current : { ...current, left }))
  }, [open, content])

  useEffect(() => {
    if (!open) return
    const dismiss = () => close()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const style: CSSProperties = {
    left: position.left,
    top: position.top,
  }

  return (
    <>
      <span
        ref={triggerRef}
        className="ui-tooltip-trigger"
        tabIndex={focusable ? 0 : undefined}
        aria-label={focusable ? label : undefined}
        aria-describedby={focusable && open ? id : undefined}
        onMouseEnter={scheduleOpen}
        onMouseLeave={close}
        onFocus={scheduleOpen}
        onBlur={close}
        onMouseDown={close}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`ui-tooltip ui-tooltip-${position.placement}`}
          style={style}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
