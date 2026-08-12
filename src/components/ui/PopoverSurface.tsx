import { forwardRef, type HTMLAttributes } from 'react'
import './PopoverSurface.css'

export type PopoverSurfaceKind = 'menu' | 'tooltip' | 'modal'

export type PopoverSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  kind: PopoverSurfaceKind
  labelledBy?: string
}

export const PopoverSurface = forwardRef<HTMLDivElement, PopoverSurfaceProps>(function PopoverSurface(
  { kind, labelledBy, className = '', ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={['ui-popover-surface', `ui-popover-${kind}`, className].filter(Boolean).join(' ')}
      aria-labelledby={labelledBy}
      {...rest}
    />
  )
})
