import type { HTMLAttributes } from 'react'

export type ChipVariant = 'default' | 'soft' | 'outline'
export type ChipSize = 'sm' | 'md'

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: ChipVariant
  size?: ChipSize
}

export function Chip({
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: ChipProps) {
  const classes = ['ui-chip', `ui-chip-${variant}`, `ui-chip-${size}`, className]
    .filter(Boolean)
    .join(' ')

  return <span className={classes} {...rest} />
}
