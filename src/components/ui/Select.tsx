import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import './Select.css'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
  icon?: ReactNode
}

type SelectPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

export const Select = forwardRef<
  HTMLButtonElement,
  {
    value: string
    options: SelectOption[]
    onValueChange: (value: string) => void
    ariaLabel: string
    className?: string
    disabled?: boolean
    placeholder?: string
  }
>(function Select(
  {
    value,
    options,
    onValueChange,
    ariaLabel,
    className = '',
    disabled = false,
    placeholder = '请选择',
  },
  forwardedRef,
) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<SelectPosition>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
    placement: 'bottom',
  })

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const assignTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) {
      const mutableRef = forwardedRef as MutableRefObject<HTMLButtonElement | null>
      mutableRef.current = node
    }
  }

  const findEnabled = (start: number, direction: 1 | -1) => {
    if (options.length === 0) return -1
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + direction * step + options.length) % options.length
      if (!options[index]?.disabled) return index
    }
    return -1
  }

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const edge = 8
    const desiredHeight = Math.min(280, options.length * 30 + 10)
    const roomBelow = window.innerHeight - rect.bottom - edge - 4
    const roomAbove = rect.top - edge - 4
    const placement = roomBelow >= Math.min(desiredHeight, 180) || roomBelow >= roomAbove
      ? 'bottom'
      : 'top'
    const available = placement === 'bottom' ? roomBelow : roomAbove
    const width = Math.max(rect.width, 140)
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge)

    setPosition({
      left,
      top: placement === 'bottom' ? rect.bottom + 4 : rect.top - 4,
      width,
      maxHeight: Math.max(96, Math.min(280, available)),
      placement,
    })
  }

  const openMenu = () => {
    if (disabled) return
    const nextIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : findEnabled(-1, 1)
    setActiveIndex(nextIndex)
    setOpen(true)
  }

  const selectOption = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      openMenu()
      return
    }
    if (!open) return

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(activeIndex)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => findEnabled(current, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const start = event.key === 'Home' ? -1 : 0
      setActiveIndex(findEnabled(start, event.key === 'Home' ? 1 : -1))
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeaheadRef.current += event.key.toLocaleLowerCase()
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = ''
      }, 500)
      const match = options.findIndex(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
      )
      if (match >= 0) setActiveIndex(match)
    }
  }

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onViewportChange = () => updatePosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
    },
    [],
  )

  const menuStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    width: position.width,
    maxHeight: position.maxHeight,
  }

  return (
    <div className={`ui-select${className ? ` ${className}` : ''}`}>
      <button
        ref={assignTriggerRef}
        type="button"
        role="combobox"
        className="ui-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        data-value={value}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`ui-select-value${selected ? '' : ' is-placeholder'}`}>
          {selected?.icon ? <span className="ui-select-option-icon">{selected.icon}</span> : null}
          <span className="ui-select-option-label">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown className="ui-select-chevron" size={14} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="listbox"
          aria-label={ariaLabel}
          className={`ui-select-menu ui-select-menu-${position.placement}`}
          style={menuStyle}
        >
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              id={`${id}-option-${index}`}
              data-option-index={index}
              data-value={option.value}
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`ui-select-option${index === activeIndex ? ' is-active' : ''}`}
              key={`${option.value}-${index}`}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index)
              }}
              onClick={() => selectOption(index)}
            >
              <span className="ui-select-option-main">
                {option.icon ? <span className="ui-select-option-icon">{option.icon}</span> : null}
                <span className="ui-select-option-label">{option.label}</span>
              </span>
              {option.value === value && <Check size={13} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
})
