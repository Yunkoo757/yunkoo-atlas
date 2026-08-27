import { ICON_SM } from '@/icons/iconSize'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
import { useModalPortalRoot } from '@/components/ui/ModalShell'
import { Check, SlidersHorizontal } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { WorkbenchView } from '@/components/Topbar'
import './DisplayMenu.css'

const SORT_OPTS: { value: DisplayPrefs['sortBy']; label: string }[] = [
  { value: 'date', label: '开仓日期' },
  { value: 'pnl', label: '盈亏金额' },
  { value: 'conviction', label: '信心度' },
]

export function DisplayMenu({ view = 'list' }: { view?: WorkbenchView }) {
  const menuId = useId()
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const popExitRef = useExitClone<HTMLDivElement>(open)
  const registerModalPortalRoot = useModalPortalRoot()
  const [pos, setPos] = useState({ top: 0, right: 0 })

  const assignPopRef = (node: HTMLDivElement | null) => {
    popRef.current = node
    popExitRef(node)
    registerModalPortalRoot(node)
  }

  const closeAndRestore = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestore()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')]
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (Math.max(-1, currentIndex) + 1) % items.length
          : currentIndex <= 0 ? items.length - 1 : currentIndex - 1
    event.preventDefault()
    event.stopPropagation()
    items[nextIndex]?.focus()
  }

  const showGrouping = view === 'list'
  const showEmptyGroups = view === 'board'
  const showSort = view === 'list' || view === 'board'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
    requestAnimationFrame(() => {
      popRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    })
  }, [open])

  return (
    <div className="display-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={'tb-btn' + (open ? ' is-open' : '')}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label="显示选项"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={ICON_SM} />
        <span>显示</span>
      </button>
      {open &&
        createPortal(
          <div
            id={menuId}
            className="display-pop"
            role="menu"
            ref={assignPopRef}
            style={{ top: pos.top, right: pos.right }}
            onKeyDown={handleMenuKeyDown}
          >
            <ToggleRow
              label="隐藏已平仓"
              checked={display.hideClosed}
              onChange={(v) => setDisplay({ hideClosed: v })}
            />
            {showEmptyGroups && (
              <ToggleRow
                label="显示空分组"
                checked={display.showEmptyGroups}
                onChange={(v) => setDisplay({ showEmptyGroups: v })}
              />
            )}
            {showGrouping && (
              <>
                <ToggleRow
                  label="按月份分组"
                  checked={display.groupByDate}
                  onChange={(v) =>
                    setDisplay({
                      groupByDate: v,
                      groupByStrategy: v ? false : display.groupByStrategy,
                    })
                  }
                />
                <ToggleRow
                  label="按策略分组"
                  checked={display.groupByStrategy}
                  onChange={(v) =>
                    setDisplay({
                      groupByStrategy: v,
                      groupByDate: v ? false : display.groupByDate,
                    })
                  }
                />
              </>
            )}
            {showSort && (
              <>
                <div className="display-divider" />
                <div className="display-label">排序</div>
                {SORT_OPTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={'display-item' + (display.sortBy === o.value ? ' is-on' : '')}
                    role="menuitemradio"
                    aria-checked={display.sortBy === o.value}
                    onClick={() => setDisplay({ sortBy: o.value })}
                  >
                    <span>{o.label}</span>
                    {display.sortBy === o.value && <Check size={ICON_SM} />}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="display-toggle"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}
