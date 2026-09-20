import { useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import './SegmentedControl.css'

export type SegmentedControlSize = 'sm' | 'md' | 'lg'

export type SegmentedControlOption<T extends string> = Readonly<{
  value: T
  id?: string
  controls?: string
  label: string
  content?: ReactNode
  disabled?: boolean
  wrap?: (button: ReactElement) => ReactElement
}>

export type SegmentedControlProps<T extends string> = Readonly<{
  label: string
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (value: T) => void
  size?: SegmentedControlSize
  className?: string
  role?: 'group' | 'tablist' | 'radiogroup'
}>

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'sm',
  className = '',
  role = 'group',
}: SegmentedControlProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const previousValue = useRef(value)
  const geometryRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const indicator = indicatorRef.current
    if (!root || !indicator) return
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.ui-segmented-option')]
    const selected = buttons.find((button) => button.dataset.value === value)
    const align = (animate: boolean) => {
      const rootRect = root.getBoundingClientRect()
      const selectedRect = selected?.getBoundingClientRect()
      if (!selectedRect?.width || !selectedRect.height || !rootRect.width || !rootRect.height) {
        delete root.dataset.indicatorReady
        geometryRef.current = null
        return
      }
      // Measure in the control's coordinate space, including inside an entering/scaled dialog.
      const style = getComputedStyle(root)
      const scaleX = rootRect.width / parseFloat(style.width)
      const scaleY = rootRect.height / parseFloat(style.height)
      const x = (selectedRect.left - rootRect.left) / scaleX - parseFloat(style.borderLeftWidth)
      const y = (selectedRect.top - rootRect.top) / scaleY - parseFloat(style.borderTopWidth)
      const width = selectedRect.width / scaleX
      const height = selectedRect.height / scaleY
      const geometry = [x, y, width, height].map((part) => part.toFixed(3)).join(',')
      if (geometry === geometryRef.current) return
      root.dataset.indicatorMoving = String(animate && geometryRef.current !== null)
      indicator.style.transform = `translate(${x}px, ${y}px)`
      indicator.style.width = `${width}px`
      indicator.style.height = `${height}px`
      root.dataset.indicatorReady = 'true'
      geometryRef.current = geometry
    }

    align(previousValue.current !== value)
    previousValue.current = value
    // The buttons also need observation: labels/fonts can change without resizing a fixed-width group.
    const observer = new ResizeObserver(() => align(false))
    observer.observe(root)
    buttons.forEach((button) => observer.observe(button))
    return () => observer.disconnect()
  })

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (buttons.length === 0) return
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length
    const nextButton = buttons[nextIndex]
    const nextValue = nextButton?.dataset.value as T | undefined
    if (!nextButton || nextValue === undefined) return
    event.preventDefault()
    nextButton.focus()
    onChange(nextValue)
  }

  return (
    <div
      ref={rootRef}
      role={role}
      aria-label={label}
      className={['ui-segmented', `ui-segmented-${size}`, className].filter(Boolean).join(' ')}
      onKeyDown={move}
    >
      <span ref={indicatorRef} className="ui-segmented-indicator" aria-hidden="true" />
      {options.map((option) => {
        const selected = option.value === value
        const button = (
          <button
            key={option.value}
            type="button"
            className="ui-segmented-option"
            data-value={option.value}
            aria-label={option.label}
            id={option.id}
            role={role === 'tablist' ? 'tab' : role === 'radiogroup' ? 'radio' : undefined}
            aria-controls={option.controls}
            aria-selected={role === 'tablist' ? selected : undefined}
            aria-checked={role === 'radiogroup' ? selected : undefined}
            aria-pressed={role === 'group' ? selected : undefined}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.content ?? option.label}
          </button>
        )
        return option.wrap ? option.wrap(button) : button
      })}
    </div>
  )
}
