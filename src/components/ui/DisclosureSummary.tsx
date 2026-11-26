import type { ComponentPropsWithoutRef } from 'react'
import { DisclosureIcon } from '@/icons/StateIcons'
import { ICON_SM } from '@/icons/iconSize'
import './DisclosureSummary.css'

export function DisclosureSummary({ children, className, ...props }: ComponentPropsWithoutRef<'summary'>) {
  return (
    <summary className={['ui-disclosure-summary', className].filter(Boolean).join(' ')} {...props}>
      <DisclosureIcon size={ICON_SM} />
      {children}
    </summary>
  )
}
