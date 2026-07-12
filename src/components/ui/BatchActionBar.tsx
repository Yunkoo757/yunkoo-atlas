import type { ReactNode } from 'react'
import './BatchActionBar.css'

type BatchActionBarProps = {
  count: number
  children: ReactNode
}

/** 列表/回收站共用的底部批量操作条（对齐 ListView 既有语汇） */
export function BatchActionBar({ count, children }: BatchActionBarProps) {
  if (count <= 0) return null

  return (
    <div className="batch-action-bar" role="toolbar" aria-label="批量操作">
      <span className="batch-action-count">已选 {count} 项</span>
      {children}
    </div>
  )
}
