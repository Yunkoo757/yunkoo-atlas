import type { ReactNode, RefObject } from 'react'
import { SlidersHorizontal, X } from '@/icons/appIcons'
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
}) {
  return (
    <div className="ui-filter-shell" ref={rootRef}>
      <div className="ui-filter-bar">
        {quickViews}
        <div className="ui-active-filters" aria-label="当前筛选条件">
          {activeFilters.length === 0 && !quickViews ? (
            <span className="ui-filter-empty">全部记录</span>
          ) : activeFilters.length > 0 ? (
            activeFilters.map((filter) =>
              filter.onRemove ? (
                <button
                  type="button"
                  className="ui-filter-chip"
                  key={filter.key}
                  onClick={filter.onRemove}
                  aria-label={`移除 ${filter.label}`}
                >
                  <span>{filter.label}</span>
                  <X size={11} />
                </button>
              ) : (
                <span className="ui-filter-chip ui-filter-chip-static" key={filter.key}>
                  {filter.label}
                </span>
              ),
            )
          ) : null}
        </div>
        <button
          type="button"
          className={'ui-filter-trigger' + (open ? ' is-open' : '')}
          ref={triggerRef}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-haspopup="dialog"
          aria-label={label}
        >
          <SlidersHorizontal size={14} />
          <span>筛选</span>
        </button>
      </div>
      {open && children}
    </div>
  )
}
