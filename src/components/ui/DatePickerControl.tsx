import { ICON_MD } from '@/icons/iconSize'
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from '@/icons/appIcons'
import { FieldTrigger } from '@/components/ui/FieldTrigger'
import { PopoverSurface } from '@/components/ui/PopoverSurface'
import { useModalPortalRoot } from '@/components/ui/ModalShell'
import { addDays, addMonthsClamped, calendarDate, parseYmd, toYmd, yearPageStart } from './datePickerCalendar'
import './DatePicker.css'

type CalendarDay = {
  key: string
  value: string
  day: number
  currentMonth: boolean
  today: boolean
}

function buildCalendarDays(viewDate: Date): CalendarDay[] {
  const first = calendarDate(viewDate.getFullYear(), viewDate.getMonth())
  const mondayOffset = (first.getDay() + 6) % 7
  const start = calendarDate(first.getFullYear(), first.getMonth(), 1 - mondayOffset)
  const today = toYmd(new Date())

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
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
  const registerModalPortalRoot = useModalPortalRoot()
  const [viewDate, setViewDate] = useState(() => parseYmd(value) ?? new Date())
  const [activeDayKey, setActiveDayKey] = useState(() => toYmd(parseYmd(value) ?? new Date()))
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days')
  const [yearStart, setYearStart] = useState(() => yearPageStart(viewDate.getFullYear()))
  const [yearInput, setYearInput] = useState('')
  const [yearError, setYearError] = useState(false)
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
    const width = popoverRef.current?.offsetWidth || 286
    const height = popoverRef.current?.offsetHeight || 338
    const roomBelow = window.innerHeight - rect.bottom - edge
    const roomAbove = rect.top - edge
    const placement = roomBelow >= Math.min(height, 260) || roomBelow >= roomAbove ? 'bottom' : 'top'
    setPosition({
      left: Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge),
      top: placement === 'bottom'
        ? Math.min(rect.bottom + 4, window.innerHeight - height - edge)
        : Math.max(rect.top - 4, height + edge),
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
    registerModalPortalRoot(node)
  }

  const openPicker = () => {
    if (disabled) return
    const activeDate = parseYmd(value) ?? new Date()
    setViewDate(activeDate)
    setActiveDayKey(toYmd(activeDate))
    setMode('days')
    setYearError(false)
    changeOpen(true)
  }

  const changeMonth = (offset: number) => {
    const current = parseYmd(activeDayKey) ?? viewDate
    const next = addMonthsClamped(current, offset)
    moveActiveDate(next)
  }

  const moveActiveDate = (next: Date) => {
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
    setActiveDayKey(toYmd(next))
    setViewDate(next)
  }

  const showYears = () => {
    setYearStart(yearPageStart(viewDate.getFullYear()))
    setYearInput(String(viewDate.getFullYear()))
    setYearError(false)
    setMode('years')
  }

  const chooseYear = (year: number) => {
    moveActiveDate(addMonthsClamped(viewDate, (year - viewDate.getFullYear()) * 12))
    setMode('months')
  }

  const jumpToYear = () => {
    const year = Number(yearInput)
    if (!/^\d{1,4}$/.test(yearInput) || year < 1 || year > 9999) {
      setYearError(true)
      return
    }
    chooseYear(year)
  }

  const changePeriod = (offset: number) => {
    if (mode === 'years') setYearStart((start) => Math.min(9988, Math.max(1, start + offset * 12)))
    else changeMonth(offset * (mode === 'months' ? 12 : 1))
  }

  const handlePeriodKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }
    const offset = offsets[event.key]
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : offset != null ? Math.max(0, Math.min(buttons.length - 1, index + offset)) : null
    if (next == null) return
    event.preventDefault()
    buttons[next]?.focus()
  }

  const handleCalendarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const active = parseYmd(activeDayKey)
    if (!active) return
    let next: Date | null = null
    if (event.key === 'ArrowLeft') next = addDays(active, -1)
    else if (event.key === 'ArrowRight') next = addDays(active, 1)
    else if (event.key === 'ArrowUp') next = addDays(active, -7)
    else if (event.key === 'ArrowDown') next = addDays(active, 7)
    else if (event.key === 'Home') next = addDays(active, -((active.getDay() + 6) % 7))
    else if (event.key === 'End') next = addDays(active, 6 - ((active.getDay() + 6) % 7))
    else if (event.key === 'PageUp') next = addMonthsClamped(active, event.shiftKey ? -12 : -1)
    else if (event.key === 'PageDown') next = addMonthsClamped(active, event.shiftKey ? 12 : 1)
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectDate(activeDayKey)
      return
    }
    if (!next) return
    event.preventDefault()
    moveActiveDate(next)
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
  }, [open, viewDate, mode, yearError])

  useLayoutEffect(() => {
    if (!open || mode !== 'days') return
    popoverRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day-key="${activeDayKey}"]`)
      ?.focus()
  }, [activeDayKey, days, open, mode])

  useLayoutEffect(() => {
    if (!open || mode === 'days') return
    if (mode === 'years') {
      const input = popoverRef.current?.querySelector<HTMLInputElement>('.ui-date-year-input')
      input?.focus()
      input?.select()
    } else {
      popoverRef.current?.querySelector<HTMLButtonElement>('.ui-date-period-grid [aria-pressed="true"]')?.focus()
    }
  }, [open, mode])

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
  // 紧凑触发器（如 Composer 三列）放不下「2026年7月21日」会把「日」挤换行；用 ISO 日期单行展示。
  const displayValue = formattedValue
    ? value
    : '选择日期'

  return (
    <div className={`ui-date-picker${className ? ` ${className}` : ''}`}>
      <FieldTrigger
        ref={assignTriggerRef}
        className="ui-date-trigger"
        expanded={open}
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
        <Calendar size={ICON_MD} aria-hidden />
      </FieldTrigger>

      {open && createPortal(
        <PopoverSurface
          ref={assignPopoverRef}
          kind="menu"
          id={id}
          role="dialog"
          aria-modal="false"
          aria-label={`${ariaLabel}日历`}
          className={`ui-date-popover ui-date-popover-${position.placement}`}
          style={popoverStyle}
        >
          <div className="ui-date-head">
            {mode === 'years' ? <strong aria-live="polite">{yearStart}–{yearStart + 11}年</strong> : (
              <button type="button" className="ui-date-heading" aria-label="选择年份和月份" onClick={showYears}>
                {viewDate.getFullYear()}年{mode === 'days' ? `${viewDate.getMonth() + 1}月` : ''}
                <ChevronDown size={ICON_MD} aria-hidden />
              </button>
            )}
            <div>
              <button type="button" aria-label={mode === 'years' ? '上一组年份' : mode === 'months' ? '上一年' : '上个月'} disabled={mode === 'years' ? yearStart === 1 : viewDate.getFullYear() === 1 && (mode === 'months' || viewDate.getMonth() === 0)} onClick={() => changePeriod(-1)}><ChevronLeft size={ICON_MD} /></button>
              <button type="button" aria-label={mode === 'years' ? '下一组年份' : mode === 'months' ? '下一年' : '下个月'} disabled={mode === 'years' ? yearStart === 9988 : viewDate.getFullYear() === 9999 && (mode === 'months' || viewDate.getMonth() === 11)} onClick={() => changePeriod(1)}><ChevronRight size={ICON_MD} /></button>
            </div>
          </div>
          {mode === 'years' && (
            <div className="ui-date-year-entry">
              <label htmlFor={`${id}-year`}>年份</label>
              <input id={`${id}-year`} className="ui-date-year-input" type="text" inputMode="numeric" maxLength={4} value={yearInput}
                aria-invalid={yearError || undefined} aria-describedby={yearError ? `${id}-year-error` : undefined}
                onChange={(event) => { setYearInput(event.target.value); setYearError(false) }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); jumpToYear() } }} />
              <button type="button" className="ui-date-jump" onClick={jumpToYear}>跳转</button>
              {yearError && <span id={`${id}-year-error`} role="alert" className="ui-date-year-error">请输入 1–9999 的年份</span>}
            </div>
          )}
          {mode !== 'days' && (
            <div className="ui-date-period-grid" role="group" aria-label={mode === 'years' ? '选择年份' : '选择月份'} onKeyDown={handlePeriodKeys}>
              {Array.from({ length: 12 }, (_, index) => mode === 'years' ? (
                <button type="button" key={yearStart + index} aria-pressed={yearStart + index === viewDate.getFullYear()} onClick={() => chooseYear(yearStart + index)}>{yearStart + index}年</button>
              ) : (
                <button type="button" key={index} aria-pressed={index === viewDate.getMonth()} onClick={() => { moveActiveDate(addMonthsClamped(viewDate, index - viewDate.getMonth())); setMode('days') }}>{index + 1}月</button>
              ))}
            </div>
          )}
          {mode === 'days' && <>
          <div className="ui-date-weekdays" aria-hidden>
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="ui-date-grid" role="grid" onKeyDown={handleCalendarKeyDown}>
            {days.map((day) => (
              <button
                type="button"
                role="gridcell"
                key={day.key}
                aria-label={day.value}
                aria-selected={day.value === value}
                data-day-key={day.key}
                disabled={!parseYmd(day.value)}
                tabIndex={day.key === activeDayKey ? 0 : -1}
                className={`${day.currentMonth ? '' : 'is-outside'}${day.today ? ' is-today' : ''}`}
                onClick={() => selectDate(day.value)}
              >
                {day.day}
              </button>
            ))}
          </div>
          </>}
          <div className="ui-date-footer">
            {mode !== 'days' && <button type="button" onClick={() => setMode('days')}>返回日历</button>}
            {allowClear && (
              <button type="button" onClick={() => selectDate('')}>清除</button>
            )}
            <button type="button" className="ui-date-today" onClick={() => selectDate(toYmd(new Date()))}>今天</button>
          </div>
        </PopoverSurface>,
        document.body,
      )}
    </div>
  )
})
