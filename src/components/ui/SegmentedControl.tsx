import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import './SegmentedControl.css'

export type SegmentedControlSize = 'sm' | 'md' | 'lg'

export type SegmentedControlOption<T extends string> = Readonly<{
  value: T
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
}>

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'sm',
  className = '',
}: SegmentedControlProps<T>) {
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
      role="group"
      aria-label={label}
      className={['ui-segmented', `ui-segmented-${size}`, className].filter(Boolean).join(' ')}
      onKeyDown={move}
    >
      {options.map((option) => {
        const selected = option.value === value
        const button = (
          <button
            key={option.value}
            type="button"
            className="ui-segmented-option"
            data-value={option.value}
            aria-label={option.label}
            aria-pressed={selected}
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
