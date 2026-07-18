import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
import './ContextMenu.css'

export type CtxItem =
  | { type: 'item'; icon?: ReactNode; label: string; hint?: string; danger?: boolean; onClick: () => void }
  | { type: 'divider' }
  | { type: 'label'; text: string }

export interface CtxState {
  x: number
  y: number
  items: CtxItem[]
}

export function ContextMenu({
  state,
  onClose,
}: {
  state: CtxState | null
  onClose: () => void
}) {
  const exitRef = useExitClone<HTMLDivElement>(Boolean(state))

  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // 延后一帧再挂，避免“打开菜单的那次事件”被立即捕获而关闭
    const id = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('contextmenu', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  // 防溢出：靠近右/下边界时回收
  const x = Math.min(state.x, window.innerWidth - 230)
  const y = Math.min(state.y, window.innerHeight - state.items.length * 30 - 16)

  return createPortal(
    <div
      ref={exitRef}
      className="ctx"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) => {
        if (it.type === 'divider') return <div className="ctx-divider" key={i} />
        if (it.type === 'label')
          return (
            <div className="ctx-label" key={i}>
              {it.text}
            </div>
          )
        return (
          <button
            key={i}
            className={'ctx-item' + (it.danger ? ' is-danger' : '')}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            {it.icon && <span className="ctx-item-icon">{it.icon}</span>}
            <span className="ctx-item-label">{it.label}</span>
            {it.hint && <span className="ctx-item-hint">{it.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
