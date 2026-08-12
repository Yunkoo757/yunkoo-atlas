import type { ReactNode } from 'react'
import { CheckCircle } from '@/icons/appIcons'
import { ICON_2XL } from '@/icons/iconSize'
import './EmptyState.css'

export type EmptyStateVariant = 'first-use' | 'filtered' | 'missing' | 'complete'

export function EmptyState({
  title,
  hint,
  action,
  secondaryAction,
  variant = 'first-use',
  className,
}: {
  title: string
  hint?: string
  action?: ReactNode
  secondaryAction?: ReactNode
  variant?: EmptyStateVariant
  className?: string
}) {
  return (
    <div className={`empty is-${variant}${className ? ` ${className}` : ''}`}>
      {variant === 'first-use' ? <div className="empty-art" aria-hidden>
        <svg width="92" height="72" viewBox="0 0 92 72" fill="none">
          {/* 托盘外形（原创绘制）*/}
          <path
            d="M14 26 L26 12 H66 L78 26 V54 a6 6 0 0 1 -6 6 H20 a6 6 0 0 1 -6 -6 Z"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M14 38 H32 a4 4 0 0 1 4 4 a4 4 0 0 0 4 4 h12 a4 4 0 0 0 4 -4 a4 4 0 0 1 4 -4 H78"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
          {/* 漂浮的小卡片 */}
          <rect
            x="36"
            y="2"
            width="20"
            height="3"
            rx="1.5"
            fill="var(--border-default)"
          />
        </svg>
      </div> : null}
      {variant === 'complete' ? (
        <CheckCircle className="empty-complete-icon" size={ICON_2XL} aria-hidden />
      ) : null}
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 className="empty-title">{title}</h2>
        {hint && <div className="empty-hint">{hint}</div>}
      </div>
      {action && <div className="empty-action">{action}</div>}
      {secondaryAction && <div className="empty-secondary-action">{secondaryAction}</div>}
    </div>
  )
}
