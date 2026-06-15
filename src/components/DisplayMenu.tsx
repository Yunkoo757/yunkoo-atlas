import { useRef, useEffect, useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import './DisplayMenu.css'

const SORT_OPTS: { value: DisplayPrefs['sortBy']; label: string }[] = [
  { value: 'date', label: '开仓日期' },
  { value: 'pnl', label: '盈亏金额' },
  { value: 'conviction', label: '信心度' },
]

export function DisplayMenu() {
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="display-menu-root" ref={ref}>
      <button
        className={'tb-btn' + (open ? ' is-open' : '')}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={14} />
        <span>显示</span>
      </button>
      {open && (
        <div className="display-pop" role="menu">
          <ToggleRow
            label="隐藏已平仓"
            checked={display.hideClosed}
            onChange={(v) => setDisplay({ hideClosed: v })}
          />
          <ToggleRow
            label="显示空分组"
            checked={display.showEmptyGroups}
            onChange={(v) => setDisplay({ showEmptyGroups: v })}
          />
          <ToggleRow
            label="按日期分组"
            checked={display.groupByDate}
            onChange={(v) => setDisplay({ groupByDate: v, groupByStrategy: v ? false : display.groupByStrategy })}
          />
          <ToggleRow
            label="按策略分组"
            checked={display.groupByStrategy}
            onChange={(v) => setDisplay({ groupByStrategy: v, groupByDate: v ? false : display.groupByDate })}
          />
          <div className="display-divider" />
          <div className="display-label">排序</div>
          {SORT_OPTS.map((o) => (
            <button
              key={o.value}
              className={'display-item' + (display.sortBy === o.value ? ' is-on' : '')}
              onClick={() => setDisplay({ sortBy: o.value })}
            >
              <span>{o.label}</span>
              {display.sortBy === o.value && <Check size={14} />}
            </button>
          ))}
        </div>
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
    <button className="display-toggle" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={'display-switch' + (checked ? ' is-on' : '')}>
        <span className="display-switch-knob" />
      </span>
    </button>
  )
}
