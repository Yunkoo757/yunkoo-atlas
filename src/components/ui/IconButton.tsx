import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import './IconButton.css'

export type IconButtonSize = 'sm' | 'md' | 'lg'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  children: ReactNode
  label: string
  tooltip?: string
  size?: IconButtonSize
  pressed?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  children,
  label,
  tooltip,
  size = 'sm',
  pressed,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps, ref) {
  const classes = [
    'ui-icon-btn',
    `ui-icon-btn-${size}`,
    pressed ? 'is-pressed' : '',
    className,
  ].filter(Boolean).join(' ')
  const button = (
    <button
      ref={ref}
      {...rest}
      type={type}
      className={classes}
      aria-label={label}
      aria-pressed={typeof pressed === 'boolean' ? pressed : undefined}
    >
      {children}
    </button>
  )

  return tooltip ? (
    <Tooltip asChild content={tooltip} label={tooltip}>
      {button}
    </Tooltip>
  ) : button
})
