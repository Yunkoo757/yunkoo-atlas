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

export type TooltipSide = 'auto' | 'top' | 'bottom' | 'right'

type TooltipPosition = {
  left: number
  top: number
  placement: 'top' | 'bottom' | 'right'
}

/** 默认加长，避免侧栏/列表快速扫过时「立刻弹出」干扰视觉。 */
const DEFAULT_TOOLTIP_DELAY_MS = 650

function assignElementRef(ref: unknown, node: HTMLElement | null): void {
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref && typeof ref === 'object' && 'current' in ref) {
    ;(ref as { current: HTMLElement | null }).current = node
  }
}

function resolvePlacement(
  side: TooltipSide,
  rect: DOMRect,
): TooltipPosition['placement'] {
  if (side === 'top' || side === 'bottom' || side === 'right') return side
  return rect.top > 48 ? 'top' : 'bottom'
}

function positionFromRect(
  rect: DOMRect,
  placement: TooltipPosition['placement'],
): TooltipPosition {
  if (placement === 'right') {
    return {
      left: rect.right + 8,
      top: rect.top + rect.height / 2,
      placement,
    }
  }
  return {
    left: rect.left + rect.width / 2,
    top: placement === 'top' ? rect.top - 6 : rect.bottom + 6,
    placement,
  }
}

export function Tooltip({
  children,
  content,
  label,
  delay = DEFAULT_TOOLTIP_DELAY_MS,
  side = 'auto',
  focusable = false,
  asChild = false,
}: {
  children: ReactNode
  content: ReactNode
  label: string
  delay?: number
  side?: TooltipSide
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
      const placement = resolvePlacement(side, rect)
      setPosition(positionFromRect(rect, placement))
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
      const triggerRect = trigger.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      if (position.placement === 'right') {
        const top = Math.min(
          Math.max(8 + tooltipRect.height / 2, triggerRect.top + triggerRect.height / 2),
          window.innerHeight - 8 - tooltipRect.height / 2,
        )
        const left = Math.min(triggerRect.right + 8, window.innerWidth - tooltipRect.width - 8)
        setPosition((current) =>
          Math.abs(current.left - left) < 0.5 && Math.abs(current.top - top) < 0.5
            ? current
            : { ...current, left, top },
        )
        return
      }
      const edge = 8 + tooltipRect.width / 2
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
  }, [open, content, position.placement])

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
