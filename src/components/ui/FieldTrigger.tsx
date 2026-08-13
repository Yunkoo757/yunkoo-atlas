import { forwardRef, type ButtonHTMLAttributes } from 'react'
import './FieldTrigger.css'

export type FieldTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  expanded?: boolean
}

export const FieldTrigger = forwardRef<HTMLButtonElement, FieldTriggerProps>(function FieldTrigger(
  { expanded, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={['ui-field-trigger', className].filter(Boolean).join(' ')}
      aria-expanded={expanded}
      {...rest}
    />
  )
})
