import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import './Menu.css'

export interface MenuOption {
  value: string
  label: string
  icon?: ReactNode
}

// Linear 风格下拉：点击 trigger 弹出，含选中勾、hover 高亮、点击外部关闭、Esc 关闭。
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
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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
    setPlacement('bottom')
    const frame = requestAnimationFrame(() => {
      const rootRect = ref.current?.getBoundingClientRect()
      const popRect = popRef.current?.getBoundingClientRect()
      if (!rootRect || !popRect) return
      const bottomOverflow = popRect.bottom > window.innerHeight - 8
      const hasRoomAbove = rootRect.top > popRect.height + 12
      setPlacement(bottomOverflow && hasRoomAbove ? 'top' : 'bottom')
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <div className="menu-root" ref={ref}>
      <div className="menu-trigger" onClick={() => setOpen((o) => !o)}>
        {trigger}
      </div>
      {open && (
        <div
          className={`menu-pop menu-${align} menu-placement-${placement}`}
          role="menu"
          ref={popRef}
        >
          {options.map((o) => (
            <button
              key={o.value}
              className="menu-item"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                onSelect(o.value)
                setOpen(false)
              }}
            >
              {o.icon && <span className="menu-item-icon">{o.icon}</span>}
              <span className="menu-item-label">{o.label}</span>
              {o.value === value && <Check size={14} className="menu-item-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
