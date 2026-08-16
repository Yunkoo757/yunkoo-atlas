import { ICON_SM } from '@/icons/iconSize'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from '@/icons/appIcons'
import { useExitClone } from '@/components/ui/useExitClone'
import './Menu.css'

export interface MenuItemOption {
  type?: 'item'
  value: string
  label: string
  icon?: ReactNode
  danger?: boolean
}

export interface MenuSeparatorOption {
  type: 'separator'
}

export type MenuOption = MenuItemOption | MenuSeparatorOption

type MenuPosition = {
  left: number
  top: number
  placement: 'bottom' | 'top'
  minWidth: number
}

const NATIVE_TRIGGER_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
].join(', ')

const FALLBACK_TRIGGER_CONTROL_SELECTOR = [
  '[role="button"]',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// 下拉菜单：点击 trigger 弹出，含选中勾、hover 高亮、点击外部关闭、Esc 关闭。
// 弹出层经 portal 挂到 body，避免被顶栏等 overflow 容器裁切。
export function Menu({
  trigger,
  options,
  value,
  onSelect,
  align = 'left',
}: {
  trigger: ReactNode
  options: MenuOption[]
  value?: string
  onSelect: (value: string) => void
  align?: 'left' | 'right'
}) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
    placement: 'bottom',
    minWidth: 180,
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const triggerControlRef = useRef<HTMLElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const popExitRef = useExitClone<HTMLDivElement>(open)
  const isSelectionMenu = value !== undefined

  const resolveTriggerControl = useCallback(() => {
    const control =
      triggerRef.current?.querySelector<HTMLElement>(NATIVE_TRIGGER_CONTROL_SELECTOR) ??
      triggerRef.current?.querySelector<HTMLElement>(FALLBACK_TRIGGER_CONTROL_SELECTOR) ??
      null
    if (control) triggerControlRef.current = control
    return control
  }, [])

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => {
      const control = resolveTriggerControl() ?? triggerControlRef.current
      control?.focus()
    })
  }, [resolveTriggerControl])

  const updatePosition = () => {
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    if (!triggerRect) return

    const edge = 8
    const popRect = popRef.current?.getBoundingClientRect()
    const popHeight = popRect?.height ?? options.length * 30 + 10
    const popWidth = Math.max(popRect?.width ?? 180, 180)
    const roomBelow = window.innerHeight - triggerRect.bottom - edge - 4
    const roomAbove = triggerRect.top - edge - 4
    const placement =
      roomBelow >= Math.min(popHeight, 120) || roomBelow >= roomAbove ? 'bottom' : 'top'

    let left =
      align === 'right' ? triggerRect.right - popWidth : triggerRect.left
    left = Math.min(Math.max(edge, left), window.innerWidth - popWidth - edge)

    setPosition({
      left,
      top: placement === 'bottom' ? triggerRect.bottom + 4 : triggerRect.top - 4,
      placement,
      minWidth: Math.max(180, triggerRect.width),
    })
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeAndRestoreFocus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [closeAndRestoreFocus, open])

  useLayoutEffect(() => {
    const control = resolveTriggerControl()
    if (!control) return
    const previous = {
      haspopup: control.getAttribute('aria-haspopup'),
      expanded: control.getAttribute('aria-expanded'),
      controls: control.getAttribute('aria-controls'),
    }
    control.setAttribute('aria-haspopup', 'menu')
    control.setAttribute('aria-expanded', String(open))
    control.setAttribute('aria-controls', menuId)
    return () => {
      for (const [name, value] of [
        ['aria-haspopup', previous.haspopup],
        ['aria-expanded', previous.expanded],
        ['aria-controls', previous.controls],
      ] as const) {
        if (value === null) control.removeAttribute(name)
        else control.setAttribute(name, value)
      }
      if (triggerControlRef.current === control) triggerControlRef.current = null
    }
  }, [menuId, open, resolveTriggerControl, trigger])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    popRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus()
    const frame = requestAnimationFrame(() => updatePosition())
    return () => cancelAnimationFrame(frame)
  }, [open, align, options.length])

  useEffect(() => {
    if (!open) return
    const onViewportChange = () => updatePosition()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, align, options.length])

  const popStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    minWidth: position.minWidth,
  }

  const assignPopRef = (node: HTMLDivElement | null) => {
    popRef.current = node
    popExitRef(node)
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)')]
    if (items.length === 0) return
    const currentIndex = items.findIndex((item) => item === document.activeElement)
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    else nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
    event.preventDefault()
    event.stopPropagation()
    items[nextIndex]?.focus()
  }

  return (
    <div className="menu-root" ref={rootRef} data-menu-id={menuId}>
      <div
        className="menu-trigger"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </div>
      {open &&
        createPortal(
          <div
            id={menuId}
            className={`menu-pop menu-placement-${position.placement}`}
            role="menu"
            ref={assignPopRef}
            style={popStyle}
            data-menu-id={menuId}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((option, index) => option.type === 'separator' ? (
              <div key={`separator-${index}`} className="menu-separator" role="separator" />
            ) : (
              <button
                key={option.value}
                className={`menu-item${option.danger ? ' menu-item-danger' : ''}`}
                role={isSelectionMenu ? 'menuitemradio' : 'menuitem'}
                aria-checked={isSelectionMenu ? option.value === value : undefined}
                onClick={() => {
                  const control = resolveTriggerControl() ?? triggerControlRef.current
                  control?.focus()
                  onSelect(option.value)
                  setOpen(false)
                }}
              >
                {option.icon && <span className="menu-item-icon">{option.icon}</span>}
                <span className="menu-item-label">{option.label}</span>
                {isSelectionMenu && option.value === value && (
                  <Check size={ICON_SM} className="menu-item-check" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
