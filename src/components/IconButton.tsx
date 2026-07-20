import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import './IconButton.css'

// Linear 校准顶栏图标按钮：28×28、完全圆角、微描边层与 150ms 过渡。
export function IconButton({
  children,
  title,
  ariaLabel,
  onClick,
  active,
}: {
  children: ReactNode
  title?: string
  ariaLabel?: string
  onClick?: () => void
  active?: boolean
}) {
  const button = (
    <button
      className={'icon-btn' + (active ? ' is-active' : '')}
      type="button"
      aria-label={ariaLabel ?? title}
      onClick={onClick}
    >
      {children}
    </button>
  )
  return title ? <Tooltip content={title} label={title}>{button}</Tooltip> : button
}
