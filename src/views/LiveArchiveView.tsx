import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { Topbar } from '@/components/Topbar'
import { TradeList } from '@/components/trades/TradeList'
import { TradeRow } from '@/components/trades/TradeRow'
import { FilterBar, type ActiveFilter } from '@/components/ui/FilterBar'
import { Select } from '@/components/ui/Select'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { fmtMoney, fmtR } from '@/lib/format'
import {
  filterAssociatedLiveArchiveCases,
  filterLiveLogRecords,
  matchesHistoricalCaseCategory,
  resolveLiveArchiveScope,
  type HistoricalCaseCategory,
} from '@/lib/liveStatisticsArchive'
import { resolveLivePerformanceCloseTradingDayKey } from '@/lib/livePerformanceCycles'
import { summarizeTradeResults } from '@/lib/tradeTruth'
import { summarizeUsdPnl } from '@/lib/cashCurrency'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import {
  CASE_TYPE_META,
  MASTERY_STATE_META,
  STATUS_META,
  type CaseType,
  type MasteryState,
  type Trade,
  type TradeSide,
  type TradeStatus,
} from '@/data/trades'
import { matchesTradeFacets } from '@/lib/tradeView'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { useStore } from '@/store/useStore'
import './LiveArchiveView.css'
import './ListView.css'
import './MissedOpportunitiesView.css'

const EMPTY_SELECTION = new Set<string>()
const HISTORICAL_CASE_CATEGORIES: HistoricalCaseCategory[] = [
  'all',
  'focus',
  'mistakes',
  'missed',
  'unreviewed',
  'reviewed',
]
const HISTORICAL_CASE_CATEGORY_LABELS: Record<HistoricalCaseCategory, string> = {
  all: '全部',
  focus: '重点',
  mistakes: '错题',
  missed: '错过机会',
  unreviewed: '待复看',
  reviewed: '已掌握',
}

function caseDateKey(trade: Trade): string | null {
  const value = trade.recordedAt ?? trade.openedAt
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? null
}

export function LiveArchiveView() {
  const { archiveId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const view = searchParams.get('view') === 'cases' ? 'cases' : 'trades'
  const requestedCategory = searchParams.get('caseCategory') as HistoricalCaseCategory | null
  const caseCategory = requestedCategory && HISTORICAL_CASE_CATEGORIES.includes(requestedCategory)
    ? requestedCategory
    : 'all'
  const query = searchParams.get('query') ?? ''
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo = searchParams.get('dateTo') ?? ''

  const pendingCount = useMemo(
    () => filterLiveLogRecords(trades, resolveLiveArchiveScope(cycles, 'pending'), startHour).length,
    [trades, cycles, startHour],
  )
  const historyMembers = useMemo(
    () => filterLiveLogRecords(trades, resolveLiveArchiveScope(cycles, 'all-archives'), startHour),
    [trades, cycles, startHour],
  )
  const associatedCases = useMemo(
    () => filterAssociatedLiveArchiveCases(trades, historyMembers),
    [trades, historyMembers],
  )
  const starredSet = useMemo(() => new Set(starredIds), [starredIds])

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const setView = useCallback((nextView: 'trades' | 'cases') => {
    const next = new URLSearchParams(searchParams)
    if (nextView === 'cases') next.set('view', 'cases')
    else {
      next.delete('view')
      next.delete('caseCategory')
      next.delete('caseType')
      next.delete('masteryState')
    }
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const setCaseCategory = useCallback((category: HistoricalCaseCategory) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', 'cases')
    if (category === 'all') next.delete('caseCategory')
    else next.set('caseCategory', category)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const requestedKey = searchParams.get('requestedKey')
  const routeNotice = searchParams.get('archiveReason') === 'missing' && (requestedKey || archiveId)
    ? `原历史范围“${requestedKey ?? archiveId}”已合并到历史实盘。`
    : null

  useEffect(() => {
    if (!archiveId) return
    const params = new URLSearchParams()
    params.set('archiveReason', 'missing')
    params.set('requestedKey', archiveId)
    navigate(`/live-history?${params.toString()}`, { replace: true })
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

  const sourceItems = view === 'cases' ? associatedCases : historyMembers
  const symbols = useMemo(
    () => [...new Set(sourceItems.map((trade) => trade.symbol).filter(Boolean))].sort(),
    [sourceItems],
  )
  const tags = useMemo(
    () => [...new Set(sourceItems.flatMap((trade) => trade.tags))].sort(),
    [sourceItems],
  )

  const visibleMembers = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    const facets = {
      symbol: searchParams.get('symbol') || undefined,
      strategyId: searchParams.get('strategyId') || undefined,
      side: (searchParams.get('side') || undefined) as TradeSide | undefined,
      status: (searchParams.get('status') || undefined) as TradeStatus | undefined,
      tag: searchParams.get('tag') || undefined,
      caseType: view === 'cases'
        ? (searchParams.get('caseType') || undefined) as CaseType | undefined
        : undefined,
      masteryState: view === 'cases'
        ? (searchParams.get('masteryState') || undefined) as MasteryState | undefined
        : undefined,
    }
    return sourceItems.filter((trade) => {
      const day = view === 'cases'
        ? caseDateKey(trade)
        : resolveLivePerformanceCloseTradingDayKey(trade, startHour)
      return (!keyword || `${trade.ref} ${trade.symbol}`.toLocaleLowerCase().includes(keyword))
        && (!dateFrom || (day !== null && day >= dateFrom))
        && (!dateTo || (day !== null && day <= dateTo))
        && matchesTradeFacets(trade, facets, startHour)
        && (view !== 'cases' || matchesHistoricalCaseCategory(trade, caseCategory, starredSet))
    })
  }, [caseCategory, dateFrom, dateTo, query, searchParams, sourceItems, starredSet, startHour, view])

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
    activeFilters.push({ key: 'query', label: `搜索 ${query.trim()}`, onRemove: () => setParam('query', '') })
  }
  if (dateFrom) {
    activeFilters.push({ key: 'from', label: `自 ${dateFrom}`, onRemove: () => setParam('dateFrom', '') })
  }
  if (dateTo) {
    activeFilters.push({ key: 'to', label: `至 ${dateTo}`, onRemove: () => setParam('dateTo', '') })
  }
  const facetLabels: Array<[string, string]> = [
    ['symbol', searchParams.get('symbol') ?? ''],
    ['strategyId', strategies.find((item) => item.id === searchParams.get('strategyId'))?.name ?? ''],
    ['side', searchParams.get('side') === 'long' ? '做多' : searchParams.get('side') === 'short' ? '做空' : ''],
    ['status', searchParams.get('status') ? STATUS_META[searchParams.get('status') as TradeStatus]?.label ?? '' : ''],
    ['tag', searchParams.get('tag') ?? ''],
    ['caseType', view === 'cases' && searchParams.get('caseType') ? CASE_TYPE_META[searchParams.get('caseType') as CaseType]?.label ?? '' : ''],
    ['masteryState', view === 'cases' && searchParams.get('masteryState') ? MASTERY_STATE_META[searchParams.get('masteryState') as MasteryState]?.label ?? '' : ''],
  ]
  for (const [key, label] of facetLabels) {
    if (label) activeFilters.push({ key, label, onRemove: () => setParam(key, '') })
  }

  const clearFilters = () => {
    const next = new URLSearchParams()
    if (view === 'cases') next.set('view', 'cases')
    if (searchParams.get('archiveReason')) next.set('archiveReason', searchParams.get('archiveReason')!)
    if (searchParams.get('requestedKey')) next.set('requestedKey', searchParams.get('requestedKey')!)
    setSearchParams(next, { replace: true })
  }

  const openTrade = useCallback((trade: Trade) => {
    const from = {
      pathname: location.pathname,
      search: location.search,
      anchorTradeId: trade.id,
    }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), { state: tradeDetailNavState(from) })
  }, [location.pathname, location.search, navigate])

  const archiveStatus = view === 'cases'
    ? `关联案例：当前显示 ${visibleMembers.length} 条，共 ${associatedCases.length} 条。`
    : `重置前记录：当前显示 ${visibleMembers.length} 条，共 ${historyMembers.length} 条，待整理 ${pendingCount} 条。`

  if (archiveId) {
    return (
      <>
        <Topbar title="历史实盘" showDisplay={false} />
        <main className="la-view">
          <p className="la-route-notice" role="status">正在合并到历史实盘…</p>
        </main>
      </>
    )
  }

  return (
    <>
      <Topbar
        title="历史实盘"
        subtitle="重置起点前的实盘与关联案例会保留在这里"
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
              state={tradeDetailNavState({ pathname: location.pathname, search: location.search })}
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
          label={view === 'cases' ? '筛选历史实盘案例' : '筛选历史实盘记录'}
          quickViews={(
            <div className="la-filter-leading">
              <div className="la-view-switch" role="tablist" aria-label="历史实盘视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'trades'}
                  className={view === 'trades' ? 'is-active' : ''}
                  onClick={() => setView('trades')}
                >
                  实盘记录
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'cases'}
                  className={view === 'cases' ? 'is-active' : ''}
                  onClick={() => setView('cases')}
                >
                  关联案例
                </button>
              </div>
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
            </div>
          )}
        >
          <div
            ref={filterPanelRef}
            className="la-filter-panel missed-filter-panel"
            id="live-archive-filter-panel"
            role="dialog"
            aria-label={view === 'cases' ? '历史实盘案例筛选' : '历史实盘记录筛选'}
          >
            <div className="missed-filter-grid la-filter-grid">
              <label className="missed-filter-field">
                <span>搜索</span>
                <input
                  data-archive-query
                  className="la-filter-input"
                  value={query}
                  onChange={(event) => setParam('query', event.target.value)}
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
                  onChange={(event) => setParam('dateFrom', event.target.value)}
                />
              </label>
              <label className="missed-filter-field">
                <span>至</span>
                <input
                  data-archive-date-to
                  className="la-filter-input"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setParam('dateTo', event.target.value)}
                />
              </label>
            </div>
            <div className="la-filter-select-grid">
              <label className="missed-filter-field">
                <span>品种</span>
                <Select
                  ariaLabel="筛选品种"
                  value={searchParams.get('symbol') ?? ''}
                  onValueChange={(value) => setParam('symbol', value)}
                  options={[{ value: '', label: '全部品种' }, ...symbols.map((value) => ({ value, label: value }))]}
                />
              </label>
              <label className="missed-filter-field">
                <span>策略</span>
                <Select
                  ariaLabel="筛选策略"
                  value={searchParams.get('strategyId') ?? ''}
                  onValueChange={(value) => setParam('strategyId', value)}
                  options={[{ value: '', label: '全部策略' }, ...strategies.map((item) => ({ value: item.id, label: item.name }))]}
                />
              </label>
              {view === 'cases' ? (
                <>
                  <label className="missed-filter-field">
                    <span>案例类型</span>
                    <Select
                      ariaLabel="筛选案例类型"
                      value={searchParams.get('caseType') ?? ''}
                      onValueChange={(value) => setParam('caseType', value)}
                      options={[
                        { value: '', label: '全部类型' },
                        ...(Object.keys(CASE_TYPE_META) as CaseType[]).map((value) => ({ value, label: CASE_TYPE_META[value].label })),
                      ]}
                    />
                  </label>
                  <label className="missed-filter-field">
                    <span>掌握状态</span>
                    <Select
                      ariaLabel="筛选掌握状态"
                      value={searchParams.get('masteryState') ?? ''}
                      onValueChange={(value) => setParam('masteryState', value)}
                      options={[
                        { value: '', label: '全部状态' },
                        ...(Object.keys(MASTERY_STATE_META) as MasteryState[]).map((value) => ({ value, label: MASTERY_STATE_META[value].label })),
                      ]}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="missed-filter-field">
                    <span>方向</span>
                    <Select
                      ariaLabel="筛选方向"
                      value={searchParams.get('side') ?? ''}
                      onValueChange={(value) => setParam('side', value)}
                      options={[
                        { value: '', label: '全部方向' },
                        { value: 'long', label: '做多' },
                        { value: 'short', label: '做空' },
                      ]}
                    />
                  </label>
                  <label className="missed-filter-field">
                    <span>状态</span>
                    <Select
                      ariaLabel="筛选状态"
                      value={searchParams.get('status') ?? ''}
                      onValueChange={(value) => setParam('status', value)}
                      options={[
                        { value: '', label: '全部状态' },
                        ...STATUS_ORDER.map((value) => ({ value, label: STATUS_META[value].label })),
                      ]}
                    />
                  </label>
                </>
              )}
              <label className="missed-filter-field">
                <span>标签</span>
                <Select
                  ariaLabel="筛选标签"
                  value={searchParams.get('tag') ?? ''}
                  onValueChange={(value) => setParam('tag', value)}
                  options={[{ value: '', label: '全部标签' }, ...tags.map((value) => ({ value, label: value }))]}
                />
              </label>
            </div>
            <button type="button" className="ui-btn ui-btn-bordered missed-filter-clear" onClick={clearFilters}>
              清除筛选
            </button>
          </div>
        </FilterBar>

        {view === 'cases' ? (
          <div className="la-case-categories" role="tablist" aria-label="关联案例分类">
            {HISTORICAL_CASE_CATEGORIES.map((category) => (
              <button
                type="button"
                role="tab"
                aria-selected={caseCategory === category}
                className={caseCategory === category ? 'is-active' : ''}
                key={category}
                onClick={() => setCaseCategory(category)}
              >
                {HISTORICAL_CASE_CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        ) : null}

        <section className="list-scroll la-content" aria-label={view === 'cases' ? '历史实盘关联案例列表' : '重置前交易列表'} ref={listScrollRef}>
          {view === 'trades' && historyMembers.length === 0 ? (
            <EmptyState
              title="还没有重置前的实盘记录"
              hint="重置实盘统计后，起点之前的已结束记录会出现在这里。"
            />
          ) : view === 'cases' && associatedCases.length === 0 ? (
            <EmptyState
              title="历史实盘还没有关联案例"
              hint="可从历史实盘交易详情创建案例记录，之后会自动归档到这里。"
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
                label: view === 'cases' ? '关联案例' : '重置前实盘',
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
              recordLabel={view === 'cases' ? '案例记录' : '交易'}
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
