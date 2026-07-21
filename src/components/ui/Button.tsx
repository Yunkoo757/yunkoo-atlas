import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'ghost' | 'bordered' | 'primary' | 'danger' | 'danger-solid'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  const sizeClass = size === 'lg' ? ' ui-btn-lg' : ''
  const classes = ['ui-btn', `ui-btn-${variant}`, sizeClass, className].filter(Boolean).join(' ')

  return <button ref={ref} type={type} className={classes} {...rest} />
})
