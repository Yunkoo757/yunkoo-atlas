import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@/components/ui/Tooltip'
import { useExitClone } from '@/components/ui/useExitClone'
import { useModalPortalRoot } from '@/components/ui/ModalShell'
import { ArrowDown, ArrowUp, MoreHorizontal, SlidersHorizontal } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { WorkbenchView } from '@/components/Topbar'
import './DisplayMenu.css'

const SORT_OPTS: { value: DisplayPrefs['sortBy']; label: string }[] = [
  { value: 'date', label: '开仓日期' },
  { value: 'pnl', label: '盈亏金额' },
  { value: 'conviction', label: '信心度' },
]

export type JournalMenuAction = {
  label: string
  count: string
  opensDialog?: boolean
  onSelect: () => void
}

export function DisplayMenu({ view = 'list', showHideClosed = true, journalActions, menuTrigger }: {
  view?: WorkbenchView
  showHideClosed?: boolean
  journalActions?: readonly JournalMenuAction[]
  menuTrigger?: RefObject<HTMLButtonElement>
}) {
  const menuId = useId()
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const localTrigger = useRef<HTMLButtonElement>(null)
  const triggerRef = menuTrigger ?? localTrigger
  const label = journalActions ? '日志选项' : '显示选项'
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
    triggerRef.current?.focus({ preventScroll: true })
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
    popRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [open])

  return (
    <div className="display-menu-root" ref={rootRef}>
      <Tooltip asChild content={label} label={label} disabled={!journalActions || open}>
        <button
          ref={triggerRef}
          type="button"
          className={'tb-btn' + (open ? ' is-open' : '')}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-label={label}
          onClick={() => setOpen((o) => !o)}
        >
          {journalActions
            ? <MoreHorizontal size={ICON_MD} aria-hidden />
            : <><SlidersHorizontal size={ICON_SM} aria-hidden /><span>显示</span></>}
        </button>
      </Tooltip>
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
            {journalActions && <div className="display-label">显示</div>}
            {showHideClosed && (
              <DisplayToggle
                label="隐藏已平仓"
                checked={display.hideClosed}
                onChange={(v) => setDisplay({ hideClosed: v })}
              />
            )}
            {showEmptyGroups && (
              <DisplayToggle
                label="显示空分组"
                checked={display.showEmptyGroups}
                onChange={(v) => setDisplay({ showEmptyGroups: v })}
              />
            )}
            {showGrouping && (
              <>
                <DisplayToggle
                  label="按月份分组"
                  checked={display.groupByDate}
                    onChange={(v) =>
                      setDisplay({
                        groupByDate: v,
                        groupByStrategy: v ? false : display.groupByStrategy,
                        ...(v ? { sortBy: 'date' as const } : {}),
                    })
                  }
                />
                <DisplayToggle
                  label="按策略分组"
                  checked={display.groupByStrategy}
                  onChange={(v) =>
                    setDisplay({
                        groupByStrategy: v,
                        groupByDate: v ? false : display.groupByDate,
                        ...(v ? { sortBy: 'date' as const } : {}),
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
                    aria-label={display.sortBy === o.value
                      ? `${o.label}，${display.sortDirection === 'asc' ? '正序' : '倒序'}`
                      : o.label}
                    onClick={() => {
                      const selected = display.sortBy === o.value
                      setDisplay({
                        sortBy: o.value,
                        sortDirection: selected
                          ? display.sortDirection === 'asc' ? 'desc' : 'asc'
                          : 'desc',
                        ...(o.value === 'date' ? {} : { groupByDate: false, groupByStrategy: false }),
                      })
                    }}
                  >
                    <span>{o.label}</span>
                    {display.sortBy === o.value && (
                      display.sortDirection === 'asc'
                        ? <ArrowUp size={ICON_SM} />
                        : <ArrowDown size={ICON_SM} />
                    )}
                  </button>
                ))}
              </>
            )}
            {journalActions && journalActions.length > 0 && (
              <div role="group" aria-label="数据整理">
                <div className="display-divider" />
                <div className="display-label" aria-hidden>数据整理</div>
                {journalActions.map(action => (
                  <button key={action.label} type="button" role="menuitem" className="display-item"
                    aria-haspopup={action.opensDialog ? 'dialog' : undefined}
                    onClick={() => {
                      setOpen(false)
                      triggerRef.current?.focus({ preventScroll: true })
                      action.onSelect()
                    }}>
                    <span>{action.label}</span>
                    <span className="display-action-count">{action.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function DisplayToggle({
  label,
  checked,
  onChange,
  role = 'menuitemcheckbox',
}: {
  role?: 'menuitemcheckbox' | 'switch'
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="display-toggle"
      role={role}
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
