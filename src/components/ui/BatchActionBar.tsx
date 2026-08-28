import type { ReactNode } from 'react'
import './BatchActionBar.css'

type BatchActionBarProps = {
  count: number
  children: ReactNode
  placement?: 'floating' | 'inline'
}

/** 列表/回收站共用的底部批量操作条（对齐 ListView 既有语汇） */
export function BatchActionBar({ count, children, placement = 'floating' }: BatchActionBarProps) {
  if (count <= 0) return null

  return (
    <div className={`batch-action-bar is-${placement}`} role="toolbar" aria-label="批量操作">
      <span className="batch-action-count">已选 {count} 项</span>
      {children}
    </div>
  )
}
