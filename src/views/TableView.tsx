import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Topbar, type WorkbenchView } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { useStore } from '@/store/useStore'
import { filterTrades, applyDisplayPrefs, type ListFilter } from '@/lib/tradeFilters'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { buildTradeTableRow } from '@/lib/tradeTable'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import type { Trade } from '@/data/trades'
import { Tooltip } from '@/components/ui/Tooltip'
import './TableView.css'

type SortKey = 'date' | 'symbol' | 'pnl' | 'r'
type SortDir = 'asc' | 'desc'

export function TableView({
  title = '交易',
  view,
  onView,
  filter = { type: 'all' },
}: {
  title?: string
  view: WorkbenchView
  onView: (v: WorkbenchView) => void
  filter?: ListFilter
}) {
  const trades = useStore((s) => s.trades).filter((t) => !t.deletedAt)
  const strategies = useStore((s) => s.strategies)
  const display = useStore((s) => s.display)
  const starredIds = useStore((s) => s.starredIds)
  const openComposer = useStore((s) => s.openComposer)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const navigate = useNavigate()

  useListContextSync(filter)

  const visible = useMemo(() => {
    const filtered = filterTrades(trades, filter, starredIds)
    const ordered = applyDisplayPrefs(filtered, display, filter)
    return sortTradesForTable(ordered, sortKey, sortDir)
  }, [trades, filter, starredIds, display, sortKey, sortDir])

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'symbol' ? 'asc' : 'desc')
  }

  const subtitle = getTradesPageSubtitle(filter)
  const isReviewCaseView = filter.tradeKind === 'case'
  const recordLabel = isReviewCaseView ? '案例记录' : '交易'

  return (
    <>
      <Topbar title={title} subtitle={subtitle} view={view} onView={onView} />
      <div className={'tv-scroll' + (isReviewCaseView ? ' tv-scroll-case' : '')}>
        {visible.length === 0 ? (
          <EmptyState
            title={isReviewCaseView ? '还没有案例记录' : '还没有交易'}
            hint={isReviewCaseView ? '表格适合批量对比错题、重点案例和复盘状态。' : '表格视图会把关键字段横向展开，适合快速对比和复盘。'}
            action={
              <button className="empty-btn" onClick={() => openComposer()}>
                <Plus size={15} />
                <span>新建{recordLabel}</span>
              </button>
            }
          />
        ) : (
          <table className={'trade-table' + (isReviewCaseView ? ' trade-table-case' : '')}>
            <thead>
              <tr>
                <th className="tv-sticky tv-col-ref">Trade</th>
                <SortTh label="Date" sortKey="date" active={sortKey} dir={sortDir} onSort={setSort} />
                <SortTh label="Symbol" sortKey="symbol" active={sortKey} dir={sortDir} onSort={setSort} />
                <th>Model</th>
                <th>Confluences</th>
                <th>Entry Signal</th>
                <th>Position</th>
                <th>Status</th>
                <SortTh label="Net PnL" sortKey="pnl" active={sortKey} dir={sortDir} onSort={setSort} align="right" />
                <SortTh label="Max R/R" sortKey="r" active={sortKey} dir={sortDir} onSort={setSort} align="right" />
                <th>Profit/Loss</th>
                <th>Mistakes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((trade) => {
                const row = buildTradeTableRow(trade, strategies)
                return (
                  <tr key={trade.id} onDoubleClick={() => navigate(tradeDetailPath(trade))}>
                    <td className="tv-sticky tv-col-ref">
                      <Link to={tradeDetailPath(trade)} className="tv-ref">
                        {row.ref}
                      </Link>
                    </td>
                    <td className="tv-date">{row.date}</td>
                    <td>
                      <span className="tv-symbol">{row.symbol}</span>
                    </td>
                    <td>
                      <span className="tv-muted-chip">{row.model}</span>
                    </td>
                    <td>
                      <ChipList items={row.confluences} fallback="—" />
                    </td>
                    <td>
                      <span className="tv-muted-chip">{row.entrySignal}</span>
                    </td>
                    <td>
                      <span className={'tv-side tv-side-' + trade.side}>{row.position}</span>
                    </td>
                    <td>
                      <span className={'tv-status tv-status-' + trade.status}>{row.status}</span>
                    </td>
                    <td className={trade.pnl > 0 ? 'tv-num tv-pos' : trade.pnl < 0 ? 'tv-num tv-neg' : 'tv-num'}>
                      {row.pnl}
                    </td>
                    <td className="tv-num">{row.rMultiple}</td>
                    <td>
                      <span className={'tv-result tv-result-' + row.result.toLowerCase()}>
                        {row.result}
                      </span>
                    </td>
                    <td>
                      <ChipList items={row.mistakes} fallback="—" tone="mistake" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function SortTh({
  label,
  sortKey,
  active,
  dir,
  align,
  onSort,
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  align?: 'right'
  onSort: (key: SortKey) => void
}) {
  const on = active === sortKey
  return (
    <th className={align === 'right' ? 'tv-th-right' : undefined}>
      <button type="button" className="tv-sort" onClick={() => onSort(sortKey)}>
        <span>{label}</span>
        {on ? dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  )
}

function ChipList({
  items,
  fallback,
  tone,
}: {
  items: string[]
  fallback: string
  tone?: 'mistake'
}) {
  if (items.length === 0) return <span className="tv-empty-cell">{fallback}</span>
  return (
    <div className="tv-chip-list">
      {items.slice(0, 3).map((item) => (
        <span className={tone === 'mistake' ? 'tv-chip tv-chip-mistake' : 'tv-chip'} key={item}>
          {item}
        </span>
      ))}
      {items.length > 3 && (
        <Tooltip
          content={items.slice(3).join(' · ')}
          label={`其余标签：${items.slice(3).join('、')}`}
          focusable
        >
          <span className="tv-chip tv-chip-more">+{items.length - 3}</span>
        </Tooltip>
      )}
    </div>
  )
}

function sortTradesForTable(trades: Trade[], key: SortKey, dir: SortDir): Trade[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...trades].sort((a, b) => {
    if (key === 'symbol') return a.symbol.localeCompare(b.symbol, 'zh-CN') * sign
    if (key === 'pnl') return (a.pnl - b.pnl) * sign
    if (key === 'r') return (a.rMultiple - b.rMultiple) * sign
    return (+new Date(a.openedAt) - +new Date(b.openedAt)) * sign
  })
}
