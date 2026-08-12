import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from '@/icons/appIcons'
import { useExitClone } from '@/components/ui/useExitClone'
import { PopoverSurface } from '@/components/ui/PopoverSurface'
import './ContextMenu.css'

export type CtxItem =
  | {
      type: 'item'
      icon?: ReactNode
      label: string
      hint?: string
      danger?: boolean
      /** 多选勾选态；展示右侧 Check */
      checked?: boolean
      /** 点击后不关闭菜单（用于连续勾选） */
      keepOpen?: boolean
      disabled?: boolean
      onClick: () => void
    }
  | { type: 'divider' }
  | { type: 'label'; text: string }

export interface CtxState {
  x: number
  y: number
  items: CtxItem[]
}

export function ContextMenu({
  state,
  items,
  anchor,
  onClose,
  restoreFocusRef,
}: {
  state?: CtxState | null
  items?: CtxItem[]
  anchor?: { x: number; y: number } | null
  onClose: () => void
  restoreFocusRef?: RefObject<HTMLElement>
}) {
  const resolvedAnchor = state ? { x: state.x, y: state.y } : anchor ?? null
  const resolvedItems = state?.items ?? items ?? []
  const open = resolvedAnchor !== null
  const exitRef = useExitClone<HTMLDivElement>(open)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const assignMenuRef = (node: HTMLDivElement | null) => {
    menuRef.current = node
    exitRef(node)
  }

  const closeAndRestore = () => {
    onClose()
    requestAnimationFrame(() => restoreFocusRef?.current?.focus())
  }

  const focusableItems = () => [
    ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []),
  ]

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = focusableItems()
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestore()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || buttons.length === 0) return
    event.preventDefault()
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    focusableItems()[0]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => onClose()
    // 延后一帧再挂，避免“打开菜单的那次事件”被立即捕获而关闭
    const id = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('contextmenu', close)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('contextmenu', close)
    }
  }, [open, onClose])

  if (!resolvedAnchor) return null

  // 防溢出：靠近右/下边界时回收
  const x = Math.min(resolvedAnchor.x, window.innerWidth - 230)
  const y = Math.min(resolvedAnchor.y, window.innerHeight - resolvedItems.length * 30 - 16)

  return createPortal(
    <PopoverSurface
      ref={assignMenuRef}
      kind="menu"
      role="menu"
      className="ctx"
      style={{ left: x, top: y }}
      onKeyDown={handleMenuKeyDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {resolvedItems.map((it, i) => {
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
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked}
            disabled={it.disabled}
            tabIndex={-1}
            onClick={() => {
              if (it.disabled) return
              it.onClick()
              if (!it.keepOpen) closeAndRestore()
            }}
          >
            {it.icon && <span className="ctx-item-icon">{it.icon}</span>}
            <span className="ctx-item-label">{it.label}</span>
            {it.hint && <span className="ctx-item-hint">{it.hint}</span>}
            {it.checked ? <Check size={14} className="ctx-item-check" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </PopoverSurface>,
    document.body,
  )
}
