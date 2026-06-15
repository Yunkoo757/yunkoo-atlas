import type { ReactNode } from 'react'
import './IconButton.css'

// 精确还原 Linear 顶栏图标按钮：28×28、完全圆角、0.8px 透明描边、
// 次级文字色、过渡 0.15s（测量自真实页面）。
export function IconButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode
  title?: string
  onClick?: () => void
}) {
  return (
    <button className="icon-btn" title={title} onClick={onClick}>
      {children}
    </button>
  )
}
