import { restoreFocusIfUnclaimed } from '@/lib/restoreFocus'
import { ICON_SM } from '@/icons/iconSize'
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
  originElement?: HTMLElement | null
}

export function ContextMenu({
  state,
  items,
  anchor,
  onClose,
  restoreFocusRef,
  className,
}: {
  state?: CtxState | null
  items?: CtxItem[]
  anchor?: { x: number; y: number } | null
  onClose: () => void
  restoreFocusRef?: RefObject<HTMLElement>
  className?: string
}) {
  const resolvedAnchor = state ? { x: state.x, y: state.y } : anchor ?? null
  const resolvedItems = state?.items ?? items ?? []
  const open = resolvedAnchor !== null
  const exitRef = useExitClone<HTMLDivElement>(open)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const assignMenuRef = (node: HTMLDivElement | null) => {
    menuRef.current = node
    exitRef(node)
  }

  const focusOrigin = () => state?.originElement ?? restoreFocusRef?.current ?? previousFocus.current

  const closeAndRestore = () => {
    const target = focusOrigin()
    onClose()
    requestAnimationFrame(() => {
      restoreFocusIfUnclaimed(target)
    })
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
    if (event.key === 'Tab') {
      focusOrigin()?.focus({ preventScroll: true })
      onClose()
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
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = focusableItems()[0] ?? menuRef.current
    target?.focus({ preventScroll: true })
  }, [open])

  const anchorX = resolvedAnchor?.x
  const anchorY = resolvedAnchor?.y
  useLayoutEffect(() => {
    const panel = menuRef.current
    if (!panel || anchorX === undefined || anchorY === undefined) return
    const position = () => {
      const edge = 8
      panel.style.left = Math.max(edge, Math.min(anchorX, innerWidth - panel.offsetWidth - edge)) + 'px'
      panel.style.top = Math.max(edge, Math.min(anchorY, innerHeight - panel.offsetHeight - edge)) + 'px'
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [anchorX, anchorY])

  useEffect(() => {
    if (!open) return
    const closeForPointer = () => onClose()
    const closeAndRestoreForScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      closeAndRestore()
    }
    // 延后一帧再挂，避免“打开菜单的那次事件”被立即捕获而关闭
    const id = window.setTimeout(() => {
      window.addEventListener('click', closeForPointer)
      window.addEventListener('scroll', closeAndRestoreForScroll, true)
      window.addEventListener('contextmenu', closeForPointer)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', closeForPointer)
      window.removeEventListener('scroll', closeAndRestoreForScroll, true)
      window.removeEventListener('contextmenu', closeForPointer)
    }
  }, [open, onClose])

  if (!resolvedAnchor) return null

  return createPortal(
    <PopoverSurface
      ref={assignMenuRef}
      kind="menu"
      role="menu"
      tabIndex={-1}
      className={['ctx', className].filter(Boolean).join(' ')}
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
              // 弹出确认框的菜单项会随菜单卸载，先让后续弹窗记住真正的入口。
              if (!it.keepOpen) focusOrigin()?.focus({ preventScroll: true })
              it.onClick()
              if (!it.keepOpen) closeAndRestore()
            }}
          >
            {it.icon && <span className="ctx-item-icon">{it.icon}</span>}
            <span className="ctx-item-label">{it.label}</span>
            {it.hint && <span className="ctx-item-hint">{it.hint}</span>}
            {it.checked ? <Check size={ICON_SM} className="ctx-item-check" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </PopoverSurface>,
    document.body,
  )
}
