import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from '@/icons/appIcons'
import './Menu.css'

export interface MenuOption {
  value: string
  label: string
  icon?: ReactNode
}

type MenuPosition = {
  left: number
  top: number
  placement: 'bottom' | 'top'
  minWidth: number
}

// Linear 风格下拉：点击 trigger 弹出，含选中勾、hover 高亮、点击外部关闭、Esc 关闭。
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
  const popRef = useRef<HTMLDivElement>(null)
  const isSelectionMenu = value !== undefined

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
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
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
            className={`menu-pop menu-placement-${position.placement}`}
            role="menu"
            ref={popRef}
            style={popStyle}
            data-menu-id={menuId}
          >
            {options.map((o) => (
              <button
                key={o.value}
                className="menu-item"
                role={isSelectionMenu ? 'menuitemradio' : 'menuitem'}
                aria-checked={isSelectionMenu ? o.value === value : undefined}
                onClick={() => {
                  onSelect(o.value)
                  setOpen(false)
                }}
              >
                {o.icon && <span className="menu-item-icon">{o.icon}</span>}
                <span className="menu-item-label">{o.label}</span>
                {isSelectionMenu && o.value === value && (
                  <Check size={14} className="menu-item-check" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
