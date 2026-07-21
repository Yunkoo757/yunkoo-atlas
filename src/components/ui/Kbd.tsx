import type { HTMLAttributes } from 'react'

export type KbdProps = HTMLAttributes<HTMLElement>

export function Kbd({ className = '', ...rest }: KbdProps) {
  const classes = ['ui-kbd', className].filter(Boolean).join(' ')
  return <kbd className={classes} {...rest} />
}
