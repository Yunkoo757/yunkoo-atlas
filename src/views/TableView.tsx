import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from '@/icons/appIcons'
import { Topbar, type WorkbenchView } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { useStore } from '@/store/useStore'
import type { ListFilter } from '@/lib/tradeFilters'
import { tradeDetailPath, tradeDetailNavState } from '@/lib/tradeRoute'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { buildTradeTableRow } from '@/lib/tradeTable'
import { intersectSelectedTradeIds } from '@/lib/tradeView'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { useWorkbenchListKeyboard } from '@/hooks/useWorkbenchListKeyboard'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { toast } from '@/lib/toast'
import type { Trade } from '@/data/trades'
import { SymbolLabel } from '@/components/SymbolIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import './TableView.css'

type SortKey = 'date' | 'symbol' | 'pnl' | 'r'
type SortDir = 'asc' | 'desc'

const TABLE_COL_COUNT = 14
const TABLE_ROW_HEIGHT = 38
const TABLE_ROW_HEIGHT_CASE = 34

const TABLE_POSITION_LABEL = { Buy: '做多', Sell: '做空' } as const
const TABLE_STATUS_LABEL: Record<string, string> = {
  Planned: '计划中',
  Open: '持仓中',
  MISS: '错过',
  'Closed by T/P': '盈利',
  'Closed by S/L': '亏损',
  Breakeven: '保本',
}
const TABLE_RESULT_LABEL = { Profit: '盈利', Loss: '亏损', Breakeven: '保本' } as const

export function TableView({
  title = '交易',
  view,
  onView,
  filter = { type: 'all' },
  header,
}: {
  title?: string
  view: WorkbenchView
  onView: (v: WorkbenchView) => void
  filter?: ListFilter
  header?: ReactNode
}) {
  const strategies = useStore((s) => s.strategies)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useListContextSync(filter)
  useTradeReturnAnchor()
  const { trades, visible: baseVisible } = useWorkbenchVisibleTrades(filter)

  const openTrade = (trade: Trade) => {
    const from = detailFrom(trade)
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), { state: tradeDetailNavState(from) })
  }

  const detailFrom = (trade: Trade) => ({
    pathname: location.pathname,
    search: location.search,
    anchorTradeId: trade.id,
  })

  const visible = useMemo(
    () => sortTradesForTable(baseVisible, sortKey, sortDir),
    [baseVisible, sortKey, sortDir],
  )
  const visibleIdsKey = visible.map((trade) => trade.id).join('\u0000')
  const isReviewCaseView = filter.tradeKind === 'case'
  const rowHeight = isReviewCaseView ? TABLE_ROW_HEIGHT_CASE : TABLE_ROW_HEIGHT

  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 16,
  })

  useEffect(() => {
    return registerTradeScrollTarget((tradeId) => {
      const index = visible.findIndex((trade) => trade.id === tradeId)
      if (index < 0) return false
      rowVirtualizer.scrollToIndex(index, { align: 'center' })
      return true
    })
  }, [visible, rowVirtualizer])

  useEffect(() => {
    if (focusIndex < 0 || focusIndex >= visible.length) return
    rowVirtualizer.scrollToIndex(focusIndex, { align: 'auto' })
  }, [focusIndex, visible.length, rowVirtualizer])

  useWorkbenchListKeyboard({
    items: visible,
    selectedIds,
    setSelectedIds,
    focusIndex,
    setFocusIndex,
    onOpenFocused: (index) => openTrade(visible[index]),
    enableNav: true,
  })

  useEffect(() => setFocusIndex(-1), [visible.length])

  useEffect(() => {
    setSelectedIds((current) => {
      const next = intersectSelectedTradeIds(current, visible)
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      return next
    })
  }, [visibleIdsKey])

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'symbol' ? 'asc' : 'desc')
  }

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = visible.length > 0 && selectedIds.size === visible.length

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(visible.map((trade) => trade.id)))
  }

  const batchDelete = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    if (actionableIds.size === 0) return
    actionableIds.forEach((id) => removeTrade(id))
    setSelectedIds(new Set())
    toast(`已移至回收站 ${actionableIds.size} 笔`)
  }

  const batchCopy = async () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    const refs = visible.filter((trade) => actionableIds.has(trade.id)).map((trade) => trade.ref)
    if (refs.length === 0) return
    try {
      await navigator.clipboard.writeText(refs.join('\n'))
      toast(`已复制 ${refs.length} 个编号`)
    } catch {
      toast('复制失败')
    }
  }

  const subtitle = getTradesPageSubtitle(filter)
  const recordLabel = isReviewCaseView ? '案例记录' : '交易'
  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
      : 0

  return (
    <>
      <Topbar title={title} subtitle={subtitle} view={view} onView={onView} />
      {header}
      <TradeFilters filter={filter} trades={trades} strategies={strategies} />
      <div
        className={'tv-scroll' + (isReviewCaseView ? ' tv-scroll-case' : '')}
        ref={scrollRef}
      >
        {visible.length === 0 ? (
          <EmptyState
            title={isReviewCaseView ? '还没有案例记录' : '还没有交易'}
            hint={isReviewCaseView ? '用表格对比错题与复盘状态。' : '表格横向展开关键字段，便于对比。'}
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
                <th className="tv-sticky tv-col-check">
                  <SelectionBox
                    checked={allSelected}
                    alwaysVisible
                    label={allSelected ? '取消全选' : '全选'}
                    onToggle={toggleSelectAll}
                  />
                </th>
                <th className="tv-sticky tv-col-ref">交易</th>
                <SortTh label="日期" sortKey="date" active={sortKey} dir={sortDir} onSort={setSort} />
                <SortTh label="品种" sortKey="symbol" active={sortKey} dir={sortDir} onSort={setSort} />
                <th>周期</th>
                <th>策略</th>
                <th>共振条件</th>
                <th>入场信号</th>
                <th>方向</th>
                <th>状态</th>
                <SortTh label="净盈亏" sortKey="pnl" active={sortKey} dir={sortDir} onSort={setSort} align="right" />
                <SortTh label="最大 R/R" sortKey="r" active={sortKey} dir={sortDir} onSort={setSort} align="right" />
                <th>结果</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden="true" className="tv-virtual-spacer">
                  <td colSpan={TABLE_COL_COUNT} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const trade = visible[virtualRow.index]!
                const row = buildTradeTableRow(trade, strategies)
                const selected = selectedIds.has(trade.id)
                const focused = virtualRow.index === focusIndex
                return (
                  <tr
                    key={trade.id}
                    data-trade-id={trade.id}
                    data-index={virtualRow.index}
                    className={
                      (selected ? 'is-selected' : '') + (focused ? ' is-focused' : '')
                    }
                    onDoubleClick={() => openTrade(trade)}
                  >
                    <td className="tv-sticky tv-col-check">
                      <SelectionBox
                        checked={selected}
                        label={`${selected ? '取消选择' : '选择'} ${trade.ref}`}
                        onToggle={() => toggleSelection(trade.id)}
                        className="tv-row-check"
                      />
                    </td>
                    <td className="tv-sticky tv-col-ref">
                      <Link
                        to={tradeDetailPath(trade)}
                        state={tradeDetailNavState(detailFrom(trade))}
                        className="tv-ref"
                        onClick={() => rememberTradeReturnAnchor(detailFrom(trade))}
                      >
                        {row.ref}
                      </Link>
                    </td>
                    <td className="tv-date">{row.date}</td>
                    <td>
                      <SymbolLabel symbol={row.symbol} overrides={symbolIcons} size={15} />
                    </td>
                    <td>
                      <span className="tv-muted-chip">{row.timeframe}</span>
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
                      <span className={'tv-side tv-side-' + trade.side}>{TABLE_POSITION_LABEL[row.position]}</span>
                    </td>
                    <td>
                      <span className={'tv-status tv-status-' + trade.status}>{TABLE_STATUS_LABEL[row.status] ?? row.status}</span>
                    </td>
                    <td className={trade.pnl > 0 ? 'tv-num tv-pos' : trade.pnl < 0 ? 'tv-num tv-neg' : 'tv-num'}>
                      {row.pnl}
                    </td>
                    <td className="tv-num">{row.rMultiple}</td>
                    <td>
                      <span className={'tv-result tv-result-' + row.result.toLowerCase()}>
                        {TABLE_RESULT_LABEL[row.result]}
                      </span>
                    </td>
                    <td>
                      <ChipList items={row.mistakes} fallback="—" tone="mistake" />
                    </td>
                  </tr>
                )
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true" className="tv-virtual-spacer">
                  <td colSpan={TABLE_COL_COUNT} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <BatchActionBar count={selectedIds.size}>
        <button type="button" className="batch-action-btn" onClick={batchCopy}>
          <Copy size={14} />
          <span>复制</span>
        </button>
        <button type="button" className="batch-action-btn batch-action-btn-danger" onClick={batchDelete}>
          <Trash2 size={14} />
          <span>删除</span>
        </button>
      </BatchActionBar>
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
