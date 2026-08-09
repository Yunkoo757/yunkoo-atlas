import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { Topbar } from '@/components/Topbar'
import { TradeList } from '@/components/trades/TradeList'
import { TradeRow } from '@/components/trades/TradeRow'
import { FilterBar, type ActiveFilter } from '@/components/ui/FilterBar'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { fmtMoney, fmtR } from '@/lib/format'
import { filterLiveLogRecords, resolveLiveArchiveScope } from '@/lib/liveStatisticsArchive'
import { resolveLivePerformanceCloseTradingDayKey } from '@/lib/livePerformanceCycles'
import { summarizeTradeResults } from '@/lib/tradeTruth'
import { summarizeUsdPnl } from '@/lib/cashCurrency'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import './LiveArchiveView.css'
import './ListView.css'
import './MissedOpportunitiesView.css'

const EMPTY_SELECTION = new Set<string>()

export function LiveArchiveView() {
  const { archiveId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const starredIds = useStore((state) => state.starredIds)
  const toggleStar = useStore((state) => state.toggleStar)
  const cycles = useStore((state) => state.livePerformanceCycles)
  const startHour = useStore((state) => state.display.tradingDayStartHour)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const filterRootRef = useRef<HTMLDivElement>(null)
  const filterTriggerRef = useRef<HTMLButtonElement>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const pendingCount = useMemo(
    () => filterLiveLogRecords(trades, resolveLiveArchiveScope(cycles, 'pending'), startHour).length,
    [trades, cycles, startHour],
  )
  const historyMembers = useMemo(
    () => filterLiveLogRecords(trades, resolveLiveArchiveScope(cycles, 'all-archives'), startHour),
    [trades, cycles, startHour],
  )

  const requestedKey = searchParams.get('requestedKey')
  const routeNotice = searchParams.get('archiveReason') === 'missing' && (requestedKey || archiveId)
    ? `原历史范围“${requestedKey ?? archiveId}”已合并到统一历史记录。`
    : null

  useEffect(() => {
    if (!archiveId) return
    const params = new URLSearchParams()
    params.set('archiveReason', 'missing')
    params.set('requestedKey', archiveId)
    navigate(`/live-archive?${params.toString()}`, { replace: true })
  }, [archiveId, navigate])

  const closeFilters = useCallback((restoreFocus = true) => {
    setFilterOpen(false)
    if (restoreFocus) requestAnimationFrame(() => filterTriggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!filterOpen) return
    filterPanelRef.current?.querySelector<HTMLElement>('input')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterRootRef.current?.contains(event.target)) {
        closeFilters(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeFilters()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeFilters, filterOpen])

  const visibleMembers = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return historyMembers.filter((trade) => {
      const day = resolveLivePerformanceCloseTradingDayKey(trade, startHour)
      return (!keyword || `${trade.ref} ${trade.symbol}`.toLocaleLowerCase().includes(keyword))
        && (!dateFrom || (day !== null && day >= dateFrom))
        && (!dateTo || (day !== null && day <= dateTo))
    })
  }, [historyMembers, query, dateFrom, dateTo, startHour])

  const metrics = useMemo(() => {
    const closed = historyMembers.filter((trade) =>
      trade.status === 'win' || trade.status === 'loss' || trade.status === 'breakeven',
    )
    const results = summarizeTradeResults(historyMembers)
    const usd = summarizeUsdPnl(historyMembers, legacyCashCurrencyAssumption)
    return {
      closedCount: closed.length,
      winRate: results.winRate,
      totalPnlLabel: usd.pnlCount ? fmtMoney(usd.totalPnl, 'USD') : '—',
      averageR: fmtR(results.averageR),
      pnlTone: usd.totalPnl > 0 ? 'is-positive' : usd.totalPnl < 0 ? 'is-negative' : '',
    }
  }, [historyMembers, legacyCashCurrencyAssumption])

  const activeFilters: ActiveFilter[] = []
  if (query.trim()) {
    activeFilters.push({ key: 'query', label: `搜索 ${query.trim()}`, onRemove: () => setQuery('') })
  }
  if (dateFrom) {
    activeFilters.push({ key: 'from', label: `自 ${dateFrom}`, onRemove: () => setDateFrom('') })
  }
  if (dateTo) {
    activeFilters.push({ key: 'to', label: `至 ${dateTo}`, onRemove: () => setDateTo('') })
  }

  const clearFilters = () => {
    setQuery('')
    setDateFrom('')
    setDateTo('')
  }

  const openTrade = useCallback((trade: Trade) => {
    const from = { pathname: '/live-archive', search: '', anchorTradeId: trade.id }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), { state: tradeDetailNavState(from) })
  }, [navigate])

  const archiveStatus = `重置前记录：共 ${historyMembers.length} 条，待整理 ${pendingCount} 条。`

  if (archiveId) {
    return (
      <>
        <Topbar title="历史记录" showDisplay={false} />
        <main className="la-view">
          <p className="la-route-notice" role="status">正在合并到统一历史记录…</p>
        </main>
      </>
    )
  }

  return (
    <>
      <Topbar
        title="历史记录"
        subtitle="重置前的实盘记录会保留在这里"
        showDisplay={false}
      />
      <main className="la-view">
        {routeNotice ? <p className="la-route-notice" role="alert">{routeNotice}</p> : null}
        <p className="la-sr-status" role="status" aria-live="polite">{archiveStatus}</p>

        {pendingCount > 0 ? (
          <div className="list-pending-entry">
            <Link
              data-pending-log-link
              className="list-pending-link"
              to="/list?statsCycle=pending"
              state={tradeDetailNavState({ pathname: '/live-archive' })}
              aria-label={`查看待整理记录，共 ${pendingCount} 条`}
            >
              待整理 {pendingCount}
            </Link>
            <Link className="list-pending-link" to="/import-data-health">
              导入日期核对
            </Link>
          </div>
        ) : (
          <div className="list-pending-entry">
            <Link className="list-pending-link" to="/import-data-health">
              导入日期核对
            </Link>
          </div>
        )}

        <FilterBar
          activeFilters={activeFilters}
          open={filterOpen}
          onToggle={() => (filterOpen ? closeFilters() : setFilterOpen(true))}
          rootRef={filterRootRef}
          triggerRef={filterTriggerRef}
          panelId="live-archive-filter-panel"
          label="筛选历史记录"
          quickViews={(
            <div className="la-results-heading" aria-label="重置前记录摘要">
              <h2>
                重置前记录 <span data-archive-closed-count>{metrics.closedCount}</span>
              </h2>
              {historyMembers.length > 0 ? (
                <p className="la-results-meta">
                  <span>胜率 {metrics.winRate == null ? '—' : `${metrics.winRate.toFixed(0)}%`}</span>
                  <span className={metrics.pnlTone}>净盈亏 {metrics.totalPnlLabel}</span>
                  <span>平均 R {metrics.averageR}</span>
                </p>
              ) : null}
            </div>
          )}
        >
          <div
            ref={filterPanelRef}
            className="la-filter-panel missed-filter-panel"
            id="live-archive-filter-panel"
            role="dialog"
            aria-label="历史记录筛选"
          >
            <div className="missed-filter-grid la-filter-grid">
              <label className="missed-filter-field">
                <span>搜索</span>
                <input
                  data-archive-query
                  className="la-filter-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="编号或品种"
                />
              </label>
              <label className="missed-filter-field">
                <span>平仓日期</span>
                <input
                  data-archive-date-from
                  className="la-filter-input"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label className="missed-filter-field">
                <span>至</span>
                <input
                  data-archive-date-to
                  className="la-filter-input"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </div>
            <button type="button" className="ui-btn ui-btn-bordered missed-filter-clear" onClick={clearFilters}>
              清除筛选
            </button>
          </div>
        </FilterBar>

        <section className="list-scroll la-content" aria-label="重置前交易列表" ref={listScrollRef}>
          {historyMembers.length === 0 ? (
            <EmptyState
              title="还没有重置前的实盘记录"
              hint="重置实盘统计后，起点之前的已结束记录会出现在这里。"
            />
          ) : visibleMembers.length === 0 ? (
            <EmptyState
              title="没有符合当前筛选的记录"
              action={(
                <button type="button" className="ui-btn ui-btn-bordered" onClick={clearFilters}>
                  清除筛选
                </button>
              )}
            />
          ) : (
            <TradeList
              groups={[{
                key: 'live-history',
                label: '重置前实盘',
                tone: 'neutral',
                recency: 'archive',
                items: visibleMembers,
              }]}
              strategies={strategies}
              focusedId={null}
              selectedIds={EMPTY_SELECTION}
              starredIds={starredIds}
              scrollParentRef={listScrollRef}
              selectionEnabled={false}
              overscan={18}
              recordLabel="交易"
              renderRow={(trade, context) => (
                <TradeRow
                  trade={trade}
                  strategies={strategies}
                  strategyStats={context.strategyStats}
                  selected={false}
                  focused={context.focused}
                  starred={starredIds.includes(trade.id)}
                  selectable={false}
                  symbolIcons={context.symbolIcons}
                  onOpen={openTrade}
                  onSelect={() => undefined}
                  onToggleStar={(item) => toggleStar(item.id)}
                />
              )}
              onOpen={openTrade}
              onSelect={() => undefined}
              onClearSelection={() => undefined}
              onToggleStar={(trade) => toggleStar(trade.id)}
              onContextMenu={() => undefined}
              onCreate={() => undefined}
            />
          )}
        </section>
      </main>
    </>
  )
}
