import { Link } from 'react-router-dom'
import { Select, type SelectOption } from '@/components/ui/Select'
import { writeTradeListPerformanceCycle } from '@/lib/livePerformanceCycleRoute'
import type {
  LivePerformanceCycle,
  ResolvedLivePerformanceCycle,
} from '@/lib/livePerformanceCycles'
import './LivePerformanceCycleControl.css'

type LivePerformanceCycleControlProps = {
  selected: ResolvedLivePerformanceCycle
  cycles: readonly LivePerformanceCycle[]
  onSelect: (value: 'pre-cycle' | 'all' | string) => void
  onManage: () => void
}

function cycleOptions(cycles: readonly LivePerformanceCycle[]): SelectOption[] {
  const current = cycles.at(-1)
  if (!current) return []
  const historical = cycles.slice(0, -1).reverse()
  return [
    { value: current.id, label: current.name },
    ...historical.map((cycle) => ({ value: cycle.id, label: cycle.name })),
    { value: 'pre-cycle', label: '统计起点前' },
    { value: 'all', label: '全部历史' },
  ]
}

function selectedLabel(selected: ResolvedLivePerformanceCycle): string {
  if (selected.key === 'pre-cycle') return '统计起点前'
  if (selected.key === 'all') return '全部历史'
  return selected.label
}

function tradeListHref(selected: ResolvedLivePerformanceCycle): string {
  const cycleId = selected.key === 'pre-cycle' ? 'pre-cycle' : selected.cycleId
  const params = writeTradeListPerformanceCycle('', cycleId)
  const query = params.toString()
  return query ? `/list?${query}` : '/list'
}

export function LivePerformanceCycleControl({
  selected,
  cycles,
  onSelect,
  onManage,
}: LivePerformanceCycleControlProps) {
  if (cycles.length === 0) {
    return (
      <div className="live-performance-cycle-control is-empty">
        <button
          type="button"
          className="live-performance-cycle-action"
          aria-haspopup="dialog"
          onClick={onManage}
        >
          开始新统计周期
        </button>
      </div>
    )
  }

  return (
    <div className="live-performance-cycle-control">
      <span className="live-performance-cycle-current">
        <span>当前统计周期 · </span>
        <strong>{selectedLabel(selected)}</strong>
      </span>
      <Select
        value={selected.key}
        options={cycleOptions(cycles)}
        onValueChange={onSelect}
        ariaLabel="统计周期"
        className="live-performance-cycle-select"
      />
      <Link
        to={tradeListHref(selected)}
        className="live-performance-cycle-action"
        data-cycle-trade-link
      >
        查看本周期交易
      </Link>
      <button
        type="button"
        className="live-performance-cycle-action"
        aria-haspopup="dialog"
        onClick={onManage}
      >
        管理周期
      </button>
    </div>
  )
}
