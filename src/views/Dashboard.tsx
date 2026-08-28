import { ICON_MD } from '@/icons/iconSize'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Topbar } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { LiveStageManager } from '@/components/LiveStageManager'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Menu } from '@/components/Menu'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { MoreHorizontal, Plus } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { fmtMoney } from '@/lib/format'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { isAccountTrade } from '@/lib/tradeKind'
import { isActive } from '@/lib/tradeStatus'
import {
  parseAnalysisScope,
  strategyAnalysisHref,
  writeAnalysisScope,
  type AnalysisRange,
  type AnalysisScope,
} from '@/lib/analysisScope'
import {
  buildDashboardStats,
  describeDashboardResultHealth,
  type DashboardCurvePoint,
} from '@/lib/dashboardStats'
import {
  buildWeeklyReviewMetrics,
  missedTradesInWeek,
  weekEndFor,
  weekStartFor,
} from '@/data/weeklyReviews'
import { MISS_REASON_META, type MissReason } from '@/data/trades'
import { parseLocalDate } from '@/lib/periods'
import {
  buildPerformanceSelection,
  buildThisWeekPerformanceSelection,
  PERFORMANCE_REPORT_CURRENCY,
} from '@/lib/performanceSelection'
import { filterStageOwnedRecords, resolveStageScope } from '@/lib/stageArchive'
import { parseTradeWorkspaceQuery } from '@/lib/tradeWorkspaceQuery'
import './Dashboard.css'
import { resolveDashboardEmptyState } from '@/lib/dashboardEmptyState'

const RANGE_OPTS: { value: AnalysisRange; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'this-week', label: '本周' },
  { value: 'this-month', label: '本月' },
  { value: 'ytd', label: '本年' },
]

/** 含深链兼容的滚动窗文案；工具栏只展示 RANGE_OPTS */
const RANGE_LABELS: Record<AnalysisRange, string> = {
  all: '全部',
  'this-week': '本周',
  'this-month': '本月',
  '30d': '近30天',
  '90d': '近90天',
  ytd: '本年',
}

export function Dashboard({ header }: { header?: ReactNode } = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const allTrades = useStore((s) => s.trades)
  const profile = useStore((s) => s.profile)
  const strategyDefs = useStore((s) => s.strategies)
  const liveStages = useStore((s) => s.liveStages)
  const currentLiveStageId = useStore((s) => s.currentLiveStageId)
  const privacyMode = useStore((s) => s.display.privacyMode)
  const tradingDayStartHour = useStore((s) => s.display.tradingDayStartHour)
  const openComposer = useStore((s) => s.openComposer)
  const [curveDataOpen, setCurveDataOpen] = useState(false)
  const [stageManagerOpen, setStageManagerOpen] = useState(false)
  const businessDateAnchor = useBusinessDateAnchor()
  const localDateKey = businessDateAnchor.currentTradingDayKey
  const parsedScope = useMemo(() => parseAnalysisScope(searchParams).scope, [searchParams])
  const workspaceQuery = useMemo(
    () => parseTradeWorkspaceQuery(searchParams, liveStages, currentLiveStageId),
    [currentLiveStageId, liveStages, searchParams],
  )
  const scope = useMemo(
    (): AnalysisScope => ({ kind: workspaceQuery.kind, range: parsedScope.range }),
    [parsedScope.range, workspaceQuery.kind],
  )
  const stageScope = useMemo(
    () => resolveStageScope(workspaceQuery.stage, liveStages, currentLiveStageId),
    [currentLiveStageId, liveStages, workspaceQuery.stage],
  )
  const scopedTrades = useMemo(
    () => filterStageOwnedRecords(allTrades, stageScope),
    [allTrades, stageScope],
  )
  const performanceBounds = null
  const hasPerformanceBounds = false

  useEffect(() => {
    const next = writeAnalysisScope(searchParams, scope)
    next.delete('statsCycle')
    next.delete('liveCycle')
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [
    scope,
    searchParams,
    setSearchParams,
  ])

  const performanceSelection = useMemo(
    () => buildPerformanceSelection(scopedTrades, {
      scope,
      anchor: businessDateAnchor,
      legacyCashCurrencyAssumption: profile.legacyCashCurrencyAssumption,
    }),
    [
      scopedTrades,
      scope,
      localDateKey,
      tradingDayStartHour,
      profile.legacyCashCurrencyAssumption,
    ],
  )
  const activeTrades = useMemo(
    () => scopedTrades.filter((trade) =>
      !trade.deletedAt &&
      isAccountTrade(trade) &&
      isActive(trade.status) &&
      (scope.kind === 'all' || trade.tradeKind === scope.kind),
    ),
    [scope.kind, scopedTrades],
  )
  const tradeById = useMemo(
    () => new Map(allTrades.filter((trade) => !trade.deletedAt).map((trade) => [trade.id, trade])),
    [allTrades],
  )

  const stats = useMemo(
    () => buildDashboardStats(
      scopedTrades,
      strategyDefs,
      performanceSelection.eligibleMetricIds,
      tradingDayStartHour,
      performanceSelection.pnlIds,
    ),
    [scopedTrades, performanceSelection.eligibleMetricIds, performanceSelection.pnlIds, strategyDefs, tradingDayStartHour],
  )
  const missingPerformanceCloseDayCount = useMemo(
    () => {
      const liveTradeIds = new Set(scopedTrades.filter((trade) => trade.tradeKind === 'live').map((trade) => trade.id))
      return [
        ...performanceSelection.missingCloseDayIds,
        ...performanceSelection.invalidCloseDayIds,
      ].filter((id) => liveTradeIds.has(id)).length
    },
    [scopedTrades, performanceSelection.invalidCloseDayIds, performanceSelection.missingCloseDayIds],
  )
  const weekStart = useMemo(() => weekStartFor(new Date(`${localDateKey}T12:00:00`)), [localDateKey])
  const weekRangeLabel = useMemo(() => formatDashboardWeekRange(weekStart), [weekStart])
  const weekPerformanceSelection = useMemo(
    () => buildThisWeekPerformanceSelection(scopedTrades, {
      scope,
      anchor: businessDateAnchor,
      legacyCashCurrencyAssumption: profile.legacyCashCurrencyAssumption,
    }),
    [scopedTrades, scope, businessDateAnchor, profile.legacyCashCurrencyAssumption],
  )
  const weekMetrics = useMemo(() => {
    const weekEligibleIds = new Set(weekPerformanceSelection.eligibleMetricIds)
    const weekTrades = scopedTrades.filter((trade) => weekEligibleIds.has(trade.id))
    const missed = missedTradesInWeek(
      scopedTrades,
      weekStart,
      tradingDayStartHour,
      performanceBounds,
    )
    return buildWeeklyReviewMetrics(weekTrades, missed, weekPerformanceSelection.pnlIds)
  }, [scopedTrades, tradingDayStartHour, weekPerformanceSelection, weekStart])
  const rangeLabel = RANGE_LABELS[scope.range] ?? '全部'
  const scopedClosedCount = performanceSelection.eligibleMetricIds.length
    + performanceSelection.conflictResultIds.length
    + performanceSelection.missingResultIds.length
  const currencyCashFactCount = performanceSelection.usdCoveredCount
    + performanceSelection.excludedUnknownCount
    + performanceSelection.excludedCurrencyCounts.reduce((total, item) => total + item.count, 0)
  const currencyExclusionLabel = [
    ...performanceSelection.excludedCurrencyCounts.map((item) => `${item.currency} ${item.count} 笔`),
    performanceSelection.excludedUnknownCount > 0
      ? `币种未知 ${performanceSelection.excludedUnknownCount} 笔`
      : '',
  ].filter(Boolean).join(' · ')
  const resultHealth = {
    conflictCount: performanceSelection.conflictResultIds.length,
    missingResultCount: performanceSelection.missingResultIds.length,
  }
  const hasClosedTrades = scopedClosedCount > 0
  const dashboardEmptyState = resolveDashboardEmptyState({
    totalRecordCount: allTrades.filter((trade) => !trade.deletedAt && isAccountTrade(trade)).length,
    scopedRecordCount: scopedTrades.filter((trade) => !trade.deletedAt && isAccountTrade(trade) && (scope.kind === 'all' || trade.tradeKind === scope.kind)).length,
    eligibleClosedCount: scopedClosedCount,
    activeRecordCount: activeTrades.length,
  })
  const weekCardEmpty = weekMetrics.tradeCount === 0 && weekMetrics.missedCount === 0
  const missedReasonSummary = Object.entries(weekMetrics.missedReasonCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${MISS_REASON_META[reason as MissReason]?.label ?? '其他'} ×${count}`)
    .join(' · ')
  const strategyLiveStage = workspaceQuery.stage
  const performanceDrilldownParams = new URLSearchParams(performanceSelection.drilldownTarget)
  if (workspaceQuery.stage === 'current') performanceDrilldownParams.delete('liveStage')
  else performanceDrilldownParams.set('liveStage', workspaceQuery.stage)
  const performanceDrilldownHref = `/list?${performanceDrilldownParams.toString()}`
  const activeListParams = new URLSearchParams()
  activeListParams.set('view', 'active')
  if (workspaceQuery.stage !== 'current') activeListParams.set('liveStage', workspaceQuery.stage)
  if (scope.kind !== 'live') activeListParams.set('kind', scope.kind)
  const activeListHref = `/list?${activeListParams.toString()}`

  const updateScope = (patch: Partial<AnalysisScope>) => {
    setSearchParams(writeAnalysisScope(searchParams, { ...scope, ...patch }), { replace: true })
  }

  const selectedStage = workspaceQuery.stage === 'current'
    ? liveStages.find((stage) => stage.id === currentLiveStageId)
    : liveStages.find((stage) => stage.id === workspaceQuery.stage)
  const stageLabel = workspaceQuery.stage === 'all-history'
    ? '全部阶段'
    : workspaceQuery.stage === 'current'
      ? '当前阶段'
      : selectedStage?.name ?? '当前阶段'
  const kindLabel = scope.kind === 'all' ? '全部记录' : scope.kind === 'paper' ? '模拟盘' : '实盘'
  const sampleLabel = (count: number) => scopedClosedCount > 0 ? `${count}/${scopedClosedCount} 笔` : undefined

  const openTrade = (tradeId: string) => {
    const t = tradeById.get(tradeId)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`, {
      state: tradeDetailNavState({ pathname: location.pathname, search: location.search }),
    })
  }

  return (
    <>
      <Topbar title="统计分析" showDisplay={false} />
      {header}
      <div className="db-scroll">
        <div className="db-analysis-rail">
        <div
          className="db-toolbar"
          data-dashboard-current-range
            aria-label={`当前分析范围：${stageLabel} · ${kindLabel} · ${rangeLabel} · 报告币种 USD`}
        >
          <div className="db-toolbar-group" aria-label="统计周期">
            <SegmentedControl
              className="db-range-control"
              label="统计周期"
              value={scope.range}
              options={RANGE_OPTS}
              onChange={(range) => updateScope({ range })}
            />
          </div>
          <div className="db-toolbar-actions">
            <Link
              to={performanceDrilldownHref}
              className="db-toolbar-link"
              data-current-live-trade-link
            >
              查看交易
            </Link>
            <Menu
              align="right"
              trigger={(
                <IconButton label="更多统计操作" size="sm">
                  <MoreHorizontal size={ICON_MD} aria-hidden />
                </IconButton>
              )}
              options={[{ value: 'manage-stage', label: '开启新实盘阶段' }]}
              onSelect={() => setStageManagerOpen(true)}
            />
          </div>
        </div>

        {stageManagerOpen ? (
          <LiveStageManager
            currentTradingDayKey={localDateKey}
            onClose={() => setStageManagerOpen(false)}
          />
        ) : null}

        <div className="db-cards" aria-label={`当前范围指标 · ${rangeLabel}`}>
          <Card
            label="净盈亏"
            value={stats.pnlCount === 0
              ? '—'
              : fmtMoney(stats.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}
            sub={sampleLabel(stats.pnlCount)}
            accent={privacyMode || stats.pnlCount === 0 || stats.totalPnl === 0 ? undefined : stats.totalPnl > 0}
            to={performanceDrilldownHref}
          />
          <Card
            label="胜率"
            value={stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`}
            sub={sampleLabel(stats.evaluatedCount)}
            to={performanceDrilldownHref}
          />
          <Card
            label="平均 R"
            value={stats.averageR == null ? '—' : `${stats.averageR > 0 ? '+' : ''}${stats.averageR.toFixed(2)}`}
            sub={sampleLabel(stats.rCount)}
            accent={stats.averageR == null || stats.averageR === 0 ? undefined : stats.averageR > 0}
            to={performanceDrilldownHref}
          />
          <Card
            label="盈利笔数"
            value={stats.evaluatedCount === 0 ? '—' : String(stats.winCount)}
            sub={scopedClosedCount > 0 ? `${stats.evaluatedCount} 笔` : undefined}
            muted
            to={performanceDrilldownHref}
          />
        </div>

        {hasClosedTrades && (
          <div className={'db-data-health' + (resultHealth.conflictCount > 0 ? ' has-conflict' : '')}>
            <div>
              <span className="db-data-health-title">数据完整度</span>
              <span className="db-data-health-copy">
                盈亏 {stats.pnlCount}/{scopedClosedCount} · R {stats.rCount}/{scopedClosedCount}
              </span>
            </div>
            <span className="db-data-health-state">
              {describeDashboardResultHealth(resultHealth)}
            </span>
          </div>
        )}

        {currencyCashFactCount > 0 ? (
          <div
            className={'db-data-health' + (performanceSelection.currencyMergeStatus === 'usd-with-exclusions' ? ' has-conflict' : '')}
            data-currency-merge-status={performanceSelection.currencyMergeStatus}
          >
            <div>
              <span className="db-data-health-title">USD 现金汇总</span>
              <span className="db-data-health-copy">
                USD 覆盖 {performanceSelection.usdCoveredCount}/{currencyCashFactCount} 笔
              </span>
            </div>
            <span className="db-data-health-state">
              {performanceSelection.currencyMergeStatus === 'usd-only'
                ? '仅合并 USD'
                : performanceSelection.currencyMergeStatus === 'no-usd-data'
                  ? `暂无 USD 现金数据${currencyExclusionLabel ? ` · 已排除 ${currencyExclusionLabel}` : ''}`
                  : `仅合并 USD · 已排除 ${currencyExclusionLabel}`}
            </span>
          </div>
        ) : null}

        {missingPerformanceCloseDayCount > 0 ? (
          <div className="db-data-health has-conflict">
            <span className="db-data-health-title">待补平仓日期</span>
            <span className="db-data-health-state">
              {missingPerformanceCloseDayCount} 笔实盘缺少有效平仓日期，暂未计入当前统计
            </span>
            <Link to="/settings/data-health" className="db-live-link">修复数据 {missingPerformanceCloseDayCount}</Link>
          </div>
        ) : null}

        {!hasClosedTrades ? (
          <EmptyState
            className="db-empty"
            title={dashboardEmptyState?.title ?? '当前范围暂无可统计结果'}
            hint={dashboardEmptyState?.hint ?? '调整范围或补全交易结果后再试。'}
            action={
              dashboardEmptyState?.primary === 'view-active' ? (
                <button type="button" className="empty-btn" onClick={() => navigate(activeListHref)}>
                  查看进行中交易
                </button>
              ) : dashboardEmptyState?.primary === 'adjust-scope' ? (
                <button type="button" className="empty-btn" onClick={() => updateScope({ kind: 'all', range: 'all' })}>
                  调整分析范围
                </button>
              ) : (
                <button type="button" className="empty-btn" onClick={() => openComposer()}>
                  <Plus size={ICON_MD} />
                  新建交易
                </button>
              )
            }
          />
        ) : (
        <section className="db-panel">
          <div className="db-panel-head">
            <div>
              <span className="db-panel-title">累计盈亏曲线</span>
              <div className="db-panel-sub">
                {scopedClosedCount} 笔已平仓 · {rangeLabel}
              </div>
            </div>
            {stats.curve.length > 0 && (
              <span className="db-panel-hint">悬停查看，点数据表打开交易</span>
            )}
          </div>
          <div className="db-chart">
            {stats.curve.length === 0 ? (
              <div className="db-chart-empty">已平仓交易尚未填写有效盈亏</div>
            ) : (
              <>
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={stats.curve} margin={{ left: -16, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide={privacyMode} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={<CurveTooltip onOpen={openTrade} privacyMode={privacyMode} />}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="equity"
                    isAnimationActive={false}
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#eq)"
                    dot={stats.curve.length <= 120
                      ? { r: 2.5, strokeWidth: 1, fill: 'var(--bg-elevated)' }
                      : false}
                    activeDot={{
                      r: 5,
                      cursor: 'pointer',
                      onClick: (_e, dot) => {
                        const p = (dot as { payload?: DashboardCurvePoint }).payload
                        if (p?.tradeId) openTrade(p.tradeId)
                      },
                    }}
                  />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <details
                  className="db-chart-data"
                  onToggle={(event) => setCurveDataOpen(event.currentTarget.open)}
                >
                  <summary>查看累计盈亏数据（{stats.curve.length} 笔）</summary>
                  {curveDataOpen ? <div className="db-chart-data-scroll">
                    <table>
                      <thead>
                        <tr><th>交易</th><th>日期</th><th>单笔盈亏</th><th>累计盈亏</th></tr>
                      </thead>
                      <tbody>
                        {stats.curve.map((point) => {
                          const trade = tradeById.get(point.tradeId)
                          return (
                            <tr key={point.tradeId}>
                              <th scope="row">
                                <Link
                                  to={trade ? tradeDetailPath(trade) : `/trade/${point.tradeId}`}
                                  state={tradeDetailNavState({ pathname: location.pathname, search: location.search })}
                                >
                                  {point.ref} · {point.label}
                                </Link>
                              </th>
                              <td>{point.date}</td>
                              <td>{fmtMoney(point.pnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</td>
                              <td>{fmtMoney(point.equity, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div> : null}
                </details>
              </>
            )}
          </div>
        </section>

        )}

        <section className={'db-week' + (weekCardEmpty ? ' is-empty' : '')} aria-label="本周交易分析">
          <div className="db-week-head">
            <div>
              <span className="db-week-title">本周交易分析</span>
              <div className="db-week-sub">
                {weekCardEmpty
                  ? hasClosedTrades
                    ? '本周暂无已平仓交易 · 当前范围仍保留上方历史统计'
                    : '本周尚无已平仓交易 · 平仓后汇总胜率、盈亏与平均 R'
                  : `${weekRangeLabel} · 按平仓日${weekMetrics.missedCount > 0 ? ` · 错过 ${weekMetrics.missedCount}` : ''}`}
              </div>
            </div>
            <div className="db-week-actions">
              <Link to="/weekly-review" className="db-week-link">打开周复盘</Link>
            </div>
          </div>
          {!weekCardEmpty ? (
            <div className="db-week-metrics">
              <div className="db-week-metric">
                <span>平仓</span>
                <strong>{weekMetrics.tradeCount}</strong>
                <small>{weekMetrics.reviewedCount} 笔已复盘</small>
              </div>
              <div className="db-week-metric">
                <span>胜率</span>
                <strong>{weekMetrics.winRate == null ? '—' : `${weekMetrics.winRate.toFixed(0)}%`}</strong>
                <small>{weekMetrics.winCount} 赢 · {weekMetrics.lossCount} 亏 · {weekMetrics.breakevenCount} 平</small>
              </div>
              <div className="db-week-metric">
                <span>净盈亏</span>
                <strong style={{ color: privacyMode || weekMetrics.pnlCount === 0 || weekMetrics.totalPnl === 0 ? undefined : weekMetrics.totalPnl > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {weekMetrics.pnlCount === 0 ? '—' : fmtMoney(weekMetrics.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}
                </strong>
                <small>{weekMetrics.pnlCount}/{weekMetrics.tradeCount} 笔含盈亏</small>
              </div>
              <div className="db-week-metric">
                <span>平均 R</span>
                <strong style={{ color: weekMetrics.averageR == null || weekMetrics.averageR === 0 ? undefined : weekMetrics.averageR > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {weekMetrics.averageR == null ? '—' : `${weekMetrics.averageR > 0 ? '+' : ''}${weekMetrics.averageR.toFixed(2)}`}
                </strong>
                <small>{weekMetrics.rCount}/{weekMetrics.tradeCount} 笔含 R</small>
              </div>
            </div>
          ) : null}
          {weekMetrics.missedCount > 0 && missedReasonSummary ? (
            <p className="db-week-missed">执行缺口：{missedReasonSummary}</p>
          ) : null}
        </section>

        {hasClosedTrades ? (
          <>

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">策略表现</span>
          </div>
          <div className="db-strats">
            {stats.strategies.length === 0 ? (
              <div className="db-strats-empty">该时间范围内暂无策略数据</div>
            ) : (
              stats.strategies.map((s) => (
                <Link to={strategyAnalysisHref(s.id, scope, strategyLiveStage)} className="db-strat" key={s.id}>
                  <div className="db-strat-head">
                    {s.meta && (
                      <StrategyIcon icon={s.meta.icon} color={s.meta.color} size={ICON_MD} />
                    )}
                    <div className="db-strat-name">{s.name}</div>
                  </div>
                  <div className="db-strat-meta">
                    {s.n}/{s.closedCount} 笔结果有效 · 盈亏 {s.pnlCount}/{s.closedCount} · 胜率 {s.winRate == null ? '—' : `${s.winRate.toFixed(0)}%`}
                  </div>
                  <div className="db-strat-bar">
                    {s.pnlCount > 0 ? (
                      <div
                        className="db-strat-fill"
                        style={{
                          transform: `scaleX(${Math.abs(s.pnl) / stats.maxAbs})`,
                          transformOrigin: 'left center',
                          background: s.pnl >= 0 ? 'var(--pos)' : 'var(--neg)',
                        }}
                      />
                    ) : null}
                  </div>
                  <div
                    className="db-strat-pnl"
                    style={{
                      color: privacyMode || s.pnlCount === 0
                        ? 'var(--text-tertiary)'
                        : s.pnl >= 0
                          ? 'var(--pos)'
                          : 'var(--neg)',
                    }}
                  >
                    {s.pnlCount === 0 ? '—' : fmtMoney(s.pnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">R 倍数分布</span>
          </div>
          <div className="db-chart">
            {stats.rCount === 0 ? (
              <div className="db-chart-empty">已平仓交易尚未填写有效 R</div>
            ) : (
              <>
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={stats.rDist} margin={{ left: -16, right: 8, top: 4 }}>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'color-mix(in srgb, var(--bg-hover) 88%, transparent)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as { label: string; n: number }
                      return (
                        <div className="db-chart-tip is-compact">
                          <div className="db-chart-tip-ref">R 倍数区间</div>
                          <div className="db-chart-tip-symbol">{d.label}</div>
                          <div className="db-chart-tip-row">
                            <span>笔数</span>
                            <strong>{d.n}</strong>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar
                    dataKey="n"
                    fill="var(--accent)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={32}
                    isAnimationActive={false}
                    activeBar={{
                      fill: 'color-mix(in srgb, var(--accent) 82%, white 18%)',
                    }}
                  />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <details className="db-chart-data is-compact">
                  <summary>查看 R 倍数分布数据</summary>
                  <div className="db-chart-data-scroll">
                    <table>
                      <thead><tr><th>R 区间</th><th>笔数</th></tr></thead>
                      <tbody>
                        {stats.rDist.map((bucket) => (
                          <tr key={bucket.label}><th scope="row">{bucket.label}</th><td>{bucket.n}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </section>
          </>
        ) : null}
        </div>
      </div>
    </>
  )
}

function CurveTooltip({
  active,
  payload,
  onOpen,
  privacyMode,
}: {
  active?: boolean
  payload?: Array<{ payload: DashboardCurvePoint }>
  onOpen: (tradeId: string) => void
  privacyMode: boolean
}) {
  if (!active || !payload?.[0]) return null
  const p = payload[0].payload
  return (
    <div
      className="db-chart-tip"
      onClick={() => onOpen(p.tradeId)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(p.tradeId)}
      role="button"
      tabIndex={0}
    >
      <div className="db-chart-tip-ref">{p.ref}</div>
      <div className="db-chart-tip-symbol">{p.label}</div>
      <div className="db-chart-tip-row">
        <span>单笔</span>
        <span style={{ color: privacyMode ? 'var(--text-tertiary)' : p.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtMoney(p.pnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</span>
      </div>
      <div className="db-chart-tip-row">
        <span>累计</span>
        <span>{fmtMoney(p.equity, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</span>
      </div>
      <div className="db-chart-tip-hint">点击查看交易</div>
    </div>
  )
}

function Card({
  label,
  value,
  sub,
  accent,
  muted,
  to,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  muted?: boolean
  to?: string
}) {
  const color = muted
    ? 'var(--text-primary)'
    : accent === undefined
      ? 'var(--text-primary)'
      : accent
        ? 'var(--pos)'
        : 'var(--neg)'
  const content = (
    <>
      <span className="db-card-label">{label}</span>
      <span className="db-card-value" style={{ color }}>
        {value}
      </span>
      {sub && <span className="db-card-sub">{sub}</span>}
    </>
  )
  return to ? (
    <Link className="db-card" to={to} data-kpi-drilldown style={{ textDecoration: 'none' }}>{content}</Link>
  ) : <div className="db-card">{content}</div>
}

function formatDashboardWeekRange(weekStart: string): string {
  const end = weekEndFor(weekStart)
  const left = parseLocalDate(weekStart)
  const right = parseLocalDate(end)
  return left.getMonth() === right.getMonth()
    ? `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getDate()}日`
    : `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getMonth() + 1}月${right.getDate()}日`
}
