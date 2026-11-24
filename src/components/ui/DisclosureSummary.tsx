import type { ReactNode } from 'react'
import { ChevronRight } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import './DisclosureSummary.css'

export function DisclosureSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="ui-disclosure-summary">
      <ChevronRight size={ICON_SM} aria-hidden />
      {children}
    </summary>
  )
}
