import type { ReactNode } from 'react'
import { DisclosureIcon } from '@/icons/StateIcons'
import { ICON_SM } from '@/icons/iconSize'
import './DisclosureSummary.css'

export function DisclosureSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="ui-disclosure-summary">
      <DisclosureIcon size={ICON_SM} />
      {children}
    </summary>
  )
}
