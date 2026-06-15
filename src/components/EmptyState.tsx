import type { ReactNode } from 'react'
import './EmptyState.css'

// Linear 风格空状态：原创线条插画 + 标题 + 提示 + 可选动作。
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden>
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
      </div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
