import { forwardRef, type ButtonHTMLAttributes } from 'react'
import './Button.css'

export type ButtonVariant = 'ghost' | 'bordered' | 'primary' | 'danger' | 'danger-solid'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'md',
    busy = false,
    disabled,
    className = '',
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = ['ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    />
  )
})
