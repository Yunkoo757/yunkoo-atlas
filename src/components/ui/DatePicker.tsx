import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
import { Calendar, ChevronLeft, ChevronRight } from '@/icons/appIcons'
import './DatePicker.css'

type CalendarDay = {
  key: string
  value: string
  day: number
  currentMonth: boolean
  today: boolean
}

function toYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYmd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function buildCalendarDays(viewDate: Date): CalendarDay[] {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset)
  const today = toYmd(new Date())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const value = toYmd(date)
    return {
      key: value,
      value,
      day: date.getDate(),
      currentMonth: date.getMonth() === viewDate.getMonth(),
      today: value === today,
    }
  })
}

export const DatePicker = forwardRef<
  HTMLButtonElement,
  {
    value: string
    onValueChange: (value: string) => void
    ariaLabel: string
    className?: string
    disabled?: boolean
    required?: boolean
    allowClear?: boolean
    autoFocus?: boolean
    autoOpen?: boolean
    onOpenChange?: (open: boolean) => void
  }
>(function DatePicker(
  {
    value,
    onValueChange,
    ariaLabel,
    className = '',
    disabled = false,
    required = false,
    allowClear = false,
    autoFocus = false,
    autoOpen = false,
    onOpenChange,
  },
  forwardedRef,
) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const popoverExitRef = useExitClone<HTMLDivElement>(open)
  const [viewDate, setViewDate] = useState(() => parseYmd(value) ?? new Date())
  const [position, setPosition] = useState({ left: 0, top: 0, placement: 'bottom' as 'top' | 'bottom' })
  const days = useMemo(() => buildCalendarDays(viewDate), [viewDate])

  const assignTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) {
      const mutableRef = forwardedRef as MutableRefObject<HTMLButtonElement | null>
      mutableRef.current = node
    }
  }

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const edge = 8
    const width = 286
    const height = 338
    const roomBelow = window.innerHeight - rect.bottom - edge
    const roomAbove = rect.top - edge
    const placement = roomBelow >= Math.min(height, 260) || roomBelow >= roomAbove ? 'bottom' : 'top'
    setPosition({
      left: Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge),
      top: placement === 'bottom' ? rect.bottom + 4 : rect.top - 4,
      placement,
    })
  }

  const changeOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  const assignPopoverRef = (node: HTMLDivElement | null) => {
    popoverRef.current = node
    popoverExitRef(node)
  }

  const openPicker = () => {
    if (disabled) return
    setViewDate(parseYmd(value) ?? new Date())
    changeOpen(true)
  }

  const changeMonth = (offset: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const selectDate = (next: string) => {
    onValueChange(next)
    changeOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus()
    if (autoOpen && !disabled) openPicker()
    // 仅用于详情页进入日期编辑态时自动展开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, viewDate])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        changeOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      changeOpen(false)
      triggerRef.current?.focus()
    }
    const onViewportChange = () => updatePosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  const popoverStyle: CSSProperties = {
    left: position.left,
    top: position.top,
  }
  const formattedValue = parseYmd(value)
  const displayValue = formattedValue
    ? `${formattedValue.getFullYear()}年${formattedValue.getMonth() + 1}月${formattedValue.getDate()}日`
    : '选择日期'

  return (
    <div className={`ui-date-picker${className ? ` ${className}` : ''}`}>
      <button
        ref={assignTriggerRef}
        type="button"
        className="ui-date-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? changeOpen(false) : openPicker())}
        onKeyDown={(event) => {
          if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
            event.preventDefault()
            openPicker()
          }
        }}
      >
        <span className={!formattedValue ? 'is-placeholder' : undefined}>{displayValue}</span>
        <Calendar size={15} aria-hidden />
      </button>

      {open && createPortal(
        <div
          ref={assignPopoverRef}
          id={id}
          role="dialog"
          aria-modal="false"
          aria-label={`${ariaLabel}日历`}
          className={`ui-date-popover ui-date-popover-${position.placement}`}
          style={popoverStyle}
        >
          <div className="ui-date-head">
            <strong>{viewDate.getFullYear()}年{viewDate.getMonth() + 1}月</strong>
            <div>
              <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
              <button type="button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="ui-date-weekdays" aria-hidden>
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="ui-date-grid" role="grid">
            {days.map((day) => (
              <button
                type="button"
                role="gridcell"
                key={day.key}
                aria-label={day.value}
                aria-selected={day.value === value}
                className={`${day.currentMonth ? '' : 'is-outside'}${day.today ? ' is-today' : ''}`}
                onClick={() => selectDate(day.value)}
              >
                {day.day}
              </button>
            ))}
          </div>
          <div className="ui-date-footer">
            {allowClear && (
              <button type="button" onClick={() => selectDate('')}>清除</button>
            )}
            <button type="button" className="ui-date-today" onClick={() => selectDate(toYmd(new Date()))}>今天</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
})
