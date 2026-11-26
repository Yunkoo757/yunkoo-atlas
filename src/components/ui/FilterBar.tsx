import { ICON_SM } from '@/icons/iconSize'
import type { ReactNode, RefObject } from 'react'
import { Filter, X } from '@/icons/appIcons'
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
  triggerRef,
  panelId,
  quickViews,
  label = '筛选交易',
  shortcutActionId,
  actions,
  trailingActions,
  preferenceActive = false,
}: {
  activeFilters: ActiveFilter[]
  open: boolean
  onToggle: () => void
  children?: ReactNode
  triggerRef?: RefObject<HTMLButtonElement>
  panelId?: string
  quickViews?: ReactNode
  label?: string
  shortcutActionId?: string
  actions?: ReactNode
  trailingActions?: ReactNode
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
      <Filter size={ICON_SM} aria-hidden />筛选
      {count > 0 ? (
        <span className="ui-filter-count" aria-hidden="true">{count}</span>
      ) : null}
    </button>
  )
  return (
    <div className="ui-filter-shell">
      <div className="ui-filter-bar">
        {quickViews}
        <div className="ui-filter-actions">
          <div className="ui-filter-data-actions">
            {actions}
            {shortcutActionId ? (
              <ShortcutTooltip actionId={shortcutActionId} label={label}>
                {trigger}
              </ShortcutTooltip>
            ) : trigger}
          </div>
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
