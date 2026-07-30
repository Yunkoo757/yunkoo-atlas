import { useMemo, useState, type ReactNode, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MISS_REASON_META, type MissReason, type Trade } from '@/data/trades'
import { FilterBar, type ActiveFilter } from '@/components/ui/FilterBar'
import { Select } from '@/components/ui/Select'
import { PERIOD_LABELS, type CalendarPeriod } from '@/lib/periods'
import { collectSymbolOptions } from '@/lib/symbolIcons'
import type { MissedOpportunityFilters as MissedFilters } from '@/lib/missedOpportunities'

const SUPPORTED_FILTERS = new Set(['period', 'symbol', 'side', 'missReason'])

export function MissedOpportunityFilters({
  trades,
  symbolCatalog,
  resultCount,
  actions,
  headingRef,
}: {
  trades: Trade[]
  symbolCatalog: string[]
  resultCount: number
  actions: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const symbols = useMemo(
    () => collectSymbolOptions(symbolCatalog, trades.map((trade) => trade.symbol)),
    [symbolCatalog, trades],
  )

  const setParam = (key: keyof MissedFilters, value: string) => {
    const next = new URLSearchParams(searchParams)
    value ? next.set(key, value) : next.delete(key)
    setSearchParams(next, { replace: true })
  }
  const removeParam = (key: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next, { replace: true })
  }
  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true })

  const activeFilters: ActiveFilter[] = []
  const period = searchParams.get('period') as CalendarPeriod | null
  const side = searchParams.get('side')
  const missReason = searchParams.get('missReason') as MissReason | null
  if (period && Object.prototype.hasOwnProperty.call(PERIOD_LABELS, period)) {
    activeFilters.push({ key: 'period', label: PERIOD_LABELS[period], onRemove: () => setParam('period', '') })
  }
  if (searchParams.get('symbol')) {
    activeFilters.push({ key: 'symbol', label: searchParams.get('symbol')!, onRemove: () => setParam('symbol', '') })
  }
  if (side === 'long' || side === 'short') {
    activeFilters.push({ key: 'side', label: side === 'long' ? '做多' : '做空', onRemove: () => setParam('side', '') })
  }
  if (missReason && Object.prototype.hasOwnProperty.call(MISS_REASON_META, missReason)) {
    activeFilters.push({
      key: 'missReason',
      label: MISS_REASON_META[missReason].label,
      onRemove: () => setParam('missReason', ''),
    })
  }
  for (const [key, value] of searchParams) {
    if (SUPPORTED_FILTERS.has(key)) continue
    activeFilters.push({
      key: `unsupported:${key}:${value}`,
      label: '未支持的筛选条件，可移除',
      onRemove: () => removeParam(key),
    })
  }

  return (
    <FilterBar
      activeFilters={activeFilters}
      open={open}
      onToggle={() => setOpen((current) => !current)}
      panelId="missed-opportunity-filter-panel"
      label="筛选错过机会"
      quickViews={(
        <h2
          id="missed-results-heading"
          ref={headingRef as RefObject<HTMLHeadingElement>}
          className="missed-results-heading"
          data-missed-total={resultCount}
          tabIndex={-1}
        >
          全部机会 <span>{resultCount}</span>
        </h2>
      )}
      actions={actions}
    >
      <div
        className="missed-filter-panel"
        id="missed-opportunity-filter-panel"
        role="dialog"
        aria-label="错过机会筛选"
      >
        <div className="missed-filter-grid">
          <FilterSelect
            label="时间"
            value={searchParams.get('period') ?? ''}
            onChange={(value) => setParam('period', value)}
            options={[
              ['', '全部时间'],
              ...(Object.keys(PERIOD_LABELS) as CalendarPeriod[]).map(
                (value) => [value, PERIOD_LABELS[value]] as [string, string],
              ),
            ]}
          />
          <FilterSelect
            label="品种"
            value={searchParams.get('symbol') ?? ''}
            onChange={(value) => setParam('symbol', value)}
            options={[['', '全部品种'], ...symbols.map((value) => [value, value] as [string, string])]}
          />
          <FilterSelect
            label="方向"
            value={searchParams.get('side') ?? ''}
            onChange={(value) => setParam('side', value)}
            options={[
              ['', '全部方向'],
              ['long', '做多'],
              ['short', '做空'],
            ]}
          />
          <FilterSelect
            label="错过原因"
            value={searchParams.get('missReason') ?? ''}
            onChange={(value) => setParam('missReason', value)}
            options={[
              ['', '全部原因'],
              ...(Object.keys(MISS_REASON_META) as MissReason[]).map(
                (value) => [value, MISS_REASON_META[value].label] as [string, string],
              ),
            ]}
          />
        </div>
        <button type="button" className="ui-btn ui-btn-bordered missed-filter-clear" onClick={clearFilters}>
          清除筛选
        </button>
      </div>
    </FilterBar>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <div className="missed-filter-field">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={onChange}
        ariaLabel={label}
        options={options.map(([optionValue, optionLabel]) => ({
          value: optionValue,
          label: optionLabel,
        }))}
      />
    </div>
  )
}
