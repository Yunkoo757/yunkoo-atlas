import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

type TooltipPosition = {
  left: number
  top: number
  placement: 'top' | 'bottom'
}

const DEFAULT_TOOLTIP_DELAY_MS = 450

function assignElementRef(ref: unknown, node: HTMLElement | null): void {
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref && typeof ref === 'object' && 'current' in ref) {
    ;(ref as { current: HTMLElement | null }).current = node
  }
}

export function Tooltip({
  children,
  content,
  label,
  delay = DEFAULT_TOOLTIP_DELAY_MS,
  focusable = false,
  asChild = false,
}: {
  children: ReactNode
  content: ReactNode
  label: string
  delay?: number
  focusable?: boolean
  asChild?: boolean
}) {
  const id = useId()
  const triggerRef = useRef<HTMLElement | null>(null)
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

  const scheduleOpen = (wait: number) => {
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
    }, wait)
  }

  const schedulePointerOpen = () => scheduleOpen(delay)
  const openFromFocus = () => scheduleOpen(0)

  useLayoutEffect(() => {
    if (!open) return
    const tooltip = tooltipRef.current
    const trigger = triggerRef.current
    if (!tooltip || !trigger) return
    const reposition = () => {
      const tooltipWidth = tooltip.getBoundingClientRect().width
      const triggerRect = trigger.getBoundingClientRect()
      const edge = 8 + tooltipWidth / 2
      const left = Math.min(
        Math.max(edge, triggerRect.left + triggerRect.width / 2),
        window.innerWidth - edge,
      )
      setPosition((current) =>
        Math.abs(current.left - left) < 0.5 ? current : { ...current, left },
      )
    }

    reposition()
    const resizeObserver = new ResizeObserver(reposition)
    resizeObserver.observe(tooltip)
    return () => resizeObserver.disconnect()
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

  const child = isValidElement(children)
    ? children as ReactElement<Record<string, unknown>>
    : null
  const compose = (current: unknown, next: () => void) => (event: unknown) => {
    if (typeof current === 'function') current(event)
    next()
  }
  const trigger = asChild && child
    ? cloneElement(child, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node
          assignElementRef((child as ReactElement & { ref?: unknown }).ref, node)
        },
        onMouseEnter: compose(child.props.onMouseEnter, schedulePointerOpen),
        onMouseLeave: compose(child.props.onMouseLeave, close),
        onFocus: compose(child.props.onFocus, openFromFocus),
        onBlur: compose(child.props.onBlur, close),
        onMouseDown: compose(child.props.onMouseDown, close),
      } as Record<string, unknown>)
    : (
        <span
          ref={triggerRef}
          className="ui-tooltip-trigger"
          tabIndex={focusable ? 0 : undefined}
          aria-label={focusable ? label : undefined}
          aria-describedby={focusable && open ? id : undefined}
          onMouseEnter={schedulePointerOpen}
          onMouseLeave={close}
          onFocus={openFromFocus}
          onBlur={close}
          onMouseDown={close}
        >
          {children}
        </span>
      )

  return (
    <>
      {trigger}
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
