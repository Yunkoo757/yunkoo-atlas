import { forwardRef, type ReactNode } from 'react'
import { AlertCircle, ChevronRight } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import './PerformanceDataNotice.css'

export const PerformanceDataNotice = forwardRef<HTMLDetailsElement, {
  label: string
  attention?: boolean
  children: ReactNode
}>(function PerformanceDataNotice({ label, attention = false, children }, ref) {
  return (
    <details className="performance-data-notice" ref={ref}>
      <summary>
        {attention && <AlertCircle className="performance-data-notice-icon" size={ICON_SM} aria-hidden />}
        <span>{label}</span>
        <ChevronRight className="performance-data-notice-chevron" size={ICON_SM} aria-hidden />
      </summary>
      <div className="performance-data-notice-body">{children}</div>
    </details>
  )
})
