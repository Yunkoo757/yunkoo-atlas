import { ICON_SM } from '@/icons/iconSize'
import type { ReactNode, RefObject } from 'react'
import { Filter, SlidersHorizontal, X } from '@/icons/appIcons'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
import { OverflowTooltip } from './Tooltip'
import './FilterBar.css'

export type ActiveFilter = {
  key: string
  label: string
  onRemove?: () => void
}

export function FilterBar({
  activeFilters,
  open,
  onToggle,
  children,
  rootRef,
  triggerRef,
  panelId,
  quickViews,
  label = '筛选交易',
  shortcutActionId,
  actions,
  trailingActions,
  journal = false,
  preferenceActive = false,
}: {
  activeFilters: ActiveFilter[]
  open: boolean
  onToggle: () => void
  children?: ReactNode
  rootRef?: RefObject<HTMLDivElement>
  triggerRef?: RefObject<HTMLButtonElement>
  panelId?: string
  quickViews?: ReactNode
  label?: string
  shortcutActionId?: string
  actions?: ReactNode
  trailingActions?: ReactNode
  journal?: boolean
  preferenceActive?: boolean
}) {
  const count = activeFilters.length + Number(preferenceActive)
  const trigger = (
    <button
      type="button"
      className={
        'ui-filter-trigger' +
        (open ? ' is-open' : '') +
        (count > 0 ? ' has-filters' : '')
      }
      ref={triggerRef}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-haspopup="dialog"
      aria-label={label}
      aria-description={count ? `已启用 ${count} 项条件` : undefined}
    >
      {journal ? <><Filter size={ICON_SM} />筛选</> : <SlidersHorizontal size={ICON_SM} />}
      {count > 0 ? (
        <span className="ui-filter-count" aria-hidden="true">{count}</span>
      ) : null}
    </button>
  )
  return (
    <div className="ui-filter-shell" ref={rootRef}>
      <div className={journal ? 'ui-filter-bar ui-filter-bar-journal' : 'ui-filter-bar'}>
        {quickViews}
        {!journal && (
          <div className="ui-active-filters" aria-label="当前筛选条件">
            {activeFilters.length === 0 && !quickViews
              ? <span className="ui-filter-empty">全部记录</span>
              : <ActiveFilterChips filters={activeFilters} />}
          </div>
        )}
        <div className="ui-filter-actions">
          {actions}
          {shortcutActionId ? (
            <ShortcutTooltip actionId={shortcutActionId} label={label}>
              {trigger}
            </ShortcutTooltip>
          ) : trigger}
          {trailingActions}
        </div>
      </div>
      {open && children}
    </div>
  )
}

export function ActiveFilterChips({ filters }: { filters: ActiveFilter[] }) {
  return filters.map((filter) => {
    const label = (
      <OverflowTooltip text={filter.label}>
        <span className="ui-filter-chip-label">{filter.label}</span>
      </OverflowTooltip>
    )
    return filter.onRemove ? (
      <button
        type="button"
        className="ui-filter-chip"
        key={filter.key}
        onClick={filter.onRemove}
        aria-label={`移除 ${filter.label}`}
      >
        {label}
        <X size={ICON_SM} />
      </button>
    ) : (
      <span className="ui-filter-chip ui-filter-chip-static" key={filter.key}>
        {label}
      </span>
    )
  })
}
