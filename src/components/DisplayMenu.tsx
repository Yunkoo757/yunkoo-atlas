import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useExitClone } from '@/components/ui/useExitClone'
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
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const popExitRef = useExitClone<HTMLDivElement>(open)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  const assignPopRef = (node: HTMLDivElement | null) => {
    popRef.current = node
    popExitRef(node)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }, [open])

  return (
    <div className="display-menu-root" ref={rootRef}>
      <button
        type="button"
        className={'tb-btn' + (open ? ' is-open' : '')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={14} />
        <span>显示</span>
      </button>
      {open &&
        createPortal(
          <div
            className="display-pop"
            role="menu"
            ref={assignPopRef}
            style={{ top: pos.top, right: pos.right }}
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
                    onClick={() => setDisplay({ sortBy: o.value })}
                  >
                    <span>{o.label}</span>
                    {display.sortBy === o.value && <Check size={14} />}
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
    <button type="button" className="display-toggle" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}
