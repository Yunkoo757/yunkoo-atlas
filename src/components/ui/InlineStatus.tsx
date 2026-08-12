import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, CircleDot } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import './InlineStatus.css'

export type InlineStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'progress'

export function InlineStatus({
  tone = 'neutral',
  title,
  detail,
  action,
  compact = false,
  className = '',
}: {
  tone?: InlineStatusTone
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  const icon = tone === 'progress'
    ? <LoadingIndicator size={ICON_MD} aria-hidden />
    : tone === 'success'
      ? <CheckCircle size={ICON_MD} aria-hidden />
      : tone === 'warning'
        ? <AlertTriangle size={ICON_MD} aria-hidden />
        : tone === 'error'
          ? <AlertCircle size={ICON_MD} aria-hidden />
          : <CircleDot size={ICON_MD} aria-hidden />
  const assertive = tone === 'error'

  return (
    <div
      className={[
        'ui-inline-status',
        `is-${tone}`,
        compact ? 'is-compact' : '',
        className,
      ].filter(Boolean).join(' ')}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
    >
      <span className="ui-inline-status-icon">{icon}</span>
      <div className="ui-inline-status-copy">
        <div className="ui-inline-status-title">{title}</div>
        {detail ? <div className="ui-inline-status-detail">{detail}</div> : null}
      </div>
      {action ? <span className="ui-inline-status-action">{action}</span> : null}
    </div>
  )
}
