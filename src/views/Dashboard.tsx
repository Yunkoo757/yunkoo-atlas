import { useValueMotion } from '@/hooks/useValueMotion'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { resultRepairAnchor, useResultRepairReturn } from '@/hooks/useResultRepairReturn'
import { ResultConflictRepair } from '@/components/ResultConflictRepair'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { DisclosureIcon } from '@/icons/StateIcons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { createRecordForContext, resolveCreateRecordAction } from '@/lib/createRecordAction'
import { Topbar } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { LiveStageManager } from '@/components/LiveStageManager'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Menu } from '@/components/Menu'
import { PerformanceDataNotice } from '@/components/PerformanceDataNotice'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ChevronRight, MoreHorizontal, Plus } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { fmtMoney } from '@/lib/format'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { collectPerformanceCloseDayRepairIds } from '@/lib/performanceCloseDayRepair'
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
} from '@/lib/dashboardStats'
import {
  buildWeeklyReviewMetrics,
  missedTradesInWeek,
  formatWeeklyReviewRange,
  weekStartFor,
} from '@/data/weeklyReviews'
import { MISS_REASON_META, type MissReason } from '@/data/trades'
import {
  buildPerformanceSelection,
  buildThisWeekPerformanceSelection,
  PERFORMANCE_REPORT_CURRENCY,
} from '@/lib/performanceSelection'
import { filterStageOwnedRecords, resolveStageScope } from '@/lib/stageArchive'
import { parseTradeWorkspaceQuery, sharedTradeWorkspaceSearch } from '@/lib/tradeWorkspaceQuery'
import { resolveDashboardEmptyState } from '@/lib/dashboardEmptyState'
import { EquityChart, RDistributionChart } from './DashboardCharts'
import './Dashboard.css'

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
  const closeDayRepairIds = useMemo(
    () => scope.kind === 'paper' ? [] : collectPerformanceCloseDayRepairIds(
      [
        ...performanceSelection.missingCloseDayIds,
        ...performanceSelection.invalidCloseDayIds,
      ],
      scopedTrades,
    ),
    [scope.kind, scopedTrades, performanceSelection.invalidCloseDayIds, performanceSelection.missingCloseDayIds],
  )
  const missingPerformanceCloseDayCount = closeDayRepairIds.length
  const weekStart = useMemo(() => weekStartFor(localDateKey), [localDateKey])
  const weekRangeLabel = useMemo(() => formatWeeklyReviewRange(weekStart), [weekStart])
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
    const missed = scope.kind === 'paper' ? [] : missedTradesInWeek(scopedTrades, weekStart, tradingDayStartHour)
    return buildWeeklyReviewMetrics(weekTrades, missed, weekPerformanceSelection.pnlIds)
  }, [scope.kind, scopedTrades, tradingDayStartHour, weekPerformanceSelection, weekStart])
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
  const unresolvedCount = resultHealth.conflictCount + resultHealth.missingResultCount
  const hasResultHealthIssue = unresolvedCount > 0
  const hasCurrencyExclusions = currencyCashFactCount > 0 && performanceSelection.currencyMergeStatus !== 'usd-only'
  const hasPartialSamples = scopedClosedCount > 0 && [stats.pnlCount, stats.evaluatedCount, stats.rCount]
    .some((count) => count !== scopedClosedCount)
  const reportNotice = hasResultHealthIssue
    ? `${unresolvedCount} 笔结果未计入`
    : missingPerformanceCloseDayCount > 0
      ? `${missingPerformanceCloseDayCount} 笔平仓日期待补`
      : hasCurrencyExclusions ? '盈亏币种口径' : hasPartialSamples ? '统计样本' : null
  const hasClosedTrades = scopedClosedCount > 0
  const dashboardEmptyState = resolveDashboardEmptyState({
    totalRecordCount: allTrades.filter((trade) => !trade.deletedAt && isAccountTrade(trade)).length,
    scopedRecordCount: scopedTrades.filter((trade) => !trade.deletedAt && isAccountTrade(trade) && (scope.kind === 'all' || trade.tradeKind === scope.kind)).length,
    eligibleClosedCount: scopedClosedCount,
    activeRecordCount: activeTrades.length,
    dateRangeLimited: scope.range !== 'all',
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

  const showAllData = () => {
    const next = writeAnalysisScope(searchParams, { kind: 'all', range: 'all' })
    next.set('liveStage', 'all')
    setSearchParams(next, { replace: true })
  }

  const selectedStage = workspaceQuery.stage === 'current'
    ? liveStages.find((stage) => stage.id === currentLiveStageId)
    : liveStages.find((stage) => stage.id === workspaceQuery.stage)
  const stageLabel = workspaceQuery.stage === 'all'
    ? '全部阶段'
    : workspaceQuery.stage === 'current'
      ? '当前阶段'
      : selectedStage?.name ?? '当前阶段'
  const kindLabel = scope.kind === 'all' ? '全部记录' : scope.kind === 'paper' ? '模拟盘' : '实盘'
  const rangeOptions = scope.range === '30d' || scope.range === '90d'
    ? [...RANGE_OPTS, { value: scope.range, label: rangeLabel }]
    : RANGE_OPTS

  const repairEntry = useResultRepairReturn()
  const openTrade = (tradeId: string, extras?: { focusField?: 'closedAt' | 'result' }) => {
    const t = tradeById.get(tradeId)
    const from = { pathname: location.pathname, search: location.search,
      anchorTradeId: extras?.focusField === 'result' ? resultRepairAnchor(tradeId) : undefined,
    }
    rememberTradeReturnAnchor(from)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`, { state: tradeDetailNavState(from, extras) })
  }

  const notice = reportNotice && (
    <PerformanceDataNotice label={reportNotice} attention={hasResultHealthIssue || missingPerformanceCloseDayCount > 0}>
      {hasPartialSamples && (
        <p>计入样本 · 盈亏 {stats.pnlCount} 笔 · 胜率 {stats.evaluatedCount} 笔 · 平均 R {stats.rCount} 笔</p>
      )}
      {hasResultHealthIssue && (
        <div className="db-data-health" data-result-health-alert>
          <span>{describeDashboardResultHealth(resultHealth)}</span>
          <ResultConflictRepair
            ref={repairEntry}
            ids={[...performanceSelection.conflictResultIds, ...performanceSelection.missingResultIds]}
            onOpenTrade={id => openTrade(id, { focusField: 'result' })}
          />
        </div>
      )}
      {hasCurrencyExclusions && (
        <div className="db-data-health" data-currency-merge-status={performanceSelection.currencyMergeStatus}>
          <span>现金盈亏口径 · 已计入 {performanceSelection.usdCoveredCount}/{currencyCashFactCount} 笔</span>
          {currencyExclusionLabel && <span>未计入：{currencyExclusionLabel}</span>}
        </div>
      )}
      {missingPerformanceCloseDayCount > 0 && (
        <div className="db-data-health">
          <span>{missingPerformanceCloseDayCount} 笔实盘平仓日期待补，暂未计入</span>
          <Button size="sm" data-close-day-repair onClick={() => openTrade(closeDayRepairIds[0], { focusField: 'closedAt' })}>
            补平仓日期
          </Button>
        </div>
      )}
    </PerformanceDataNotice>
  )

  return (
    <>
      <Topbar title="统计分析" showDisplay={false} />
      <div className="db-scroll">
        <div className="db-analysis-rail">
          <div
            className="db-toolbar"
            data-dashboard-current-range
            aria-label={`当前分析范围：${stageLabel} · ${kindLabel} · ${rangeLabel} · 报告币种 USD`}
          >
            <div className="db-toolbar-group">
              {header}
              <SegmentedControl
                label="统计周期"
                value={scope.range}
                options={rangeOptions}
                onChange={(range) => updateScope({ range })}
              />
            </div>
            <div className="db-toolbar-actions">
              {hasClosedTrades && (
                <Link to={performanceDrilldownHref} className="ui-btn ui-btn-ghost ui-btn-sm" data-current-live-trade-link>
                  查看交易<ChevronRight size={ICON_SM} aria-hidden />
                </Link>
              )}
              <Menu
                align="right"
                trigger={<IconButton label="更多统计操作" size="sm"><MoreHorizontal size={ICON_MD} aria-hidden /></IconButton>}
                options={[{ value: 'manage-stage', label: '开启新实盘阶段' }]}
                onSelect={() => setStageManagerOpen(true)}
              />
            </div>
          </div>

          {stageManagerOpen && (
            <LiveStageManager currentTradingDayKey={localDateKey} onClose={() => setStageManagerOpen(false)} />
          )}

          {hasClosedTrades ? (
            <section className="db-panel db-performance" aria-label="盈亏概况">
              {stats.evaluatedCount > 0 ? (
                <>
                  <div className="db-cards" role="group" aria-label="当前范围指标">
                    <Metric
                      label="净盈亏"
                      value={stats.pnlCount ? fmtMoney(stats.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'}
                      to={performanceDrilldownHref}
                      primary
                    />
                    <Metric label="胜率" value={rateLabel(stats.winRate)} to={performanceDrilldownHref} />
                    <Metric label="平均 R" value={averageRLabel(stats.averageR)} to={performanceDrilldownHref} />
                  </div>
                  <EquityChart curve={stats.curve} privacyMode={privacyMode} onOpenTrade={openTrade} />
                </>
              ) : (
                <div className="db-no-results">
                  <h2 className="db-panel-title">当前范围暂无可用结果</h2>
                  <p>补齐交易结果后即可查看盈亏和策略表现。</p>
                </div>
              )}
              <div className="db-report-context">
                <p>{scopedClosedCount} 笔已平仓<span aria-hidden="true"> · </span>逐笔累计</p>
                {notice}
              </div>
            </section>
          ) : (
            <>
              <EmptyState
                className="db-empty"
                variant={dashboardEmptyState?.kind === 'library' ? 'first-use' : 'filtered'}
                title={dashboardEmptyState?.title ?? '当前范围暂无可统计结果'}
                hint={dashboardEmptyState?.hint}
                action={dashboardEmptyState?.primary === 'view-active' ? (
                  <Button variant="bordered" onClick={() => navigate(activeListHref)}>查看进行中交易</Button>
                ) : dashboardEmptyState?.primary === 'all-data' ? (
                  <Button variant="bordered" onClick={showAllData}>{dashboardEmptyState.primaryLabel}</Button>
                ) : dashboardEmptyState?.primary === 'all-dates' ? (
                  <Button variant="bordered" onClick={() => updateScope({ range: 'all' })}>{dashboardEmptyState.primaryLabel}</Button>
                ) : dashboardEmptyState?.primary === 'view-records' ? (
                  <Link className="ui-btn ui-btn-bordered ui-btn-md" to={`/list${sharedTradeWorkspaceSearch(location.search)}`}>{dashboardEmptyState.primaryLabel}</Link>
                ) : (
                  <Button variant="primary" onClick={() => createRecordForContext(location.pathname, location.search, navigate)}>
                    <Plus size={ICON_MD} aria-hidden />
                    {resolveCreateRecordAction(location.pathname, location.search).label}
                  </Button>
                )}
              />
              {notice}
            </>
          )}

          {stats.evaluatedCount > 0 && (
            <div className="db-breakdown">
              <section className="db-panel db-strategy-panel" aria-labelledby="db-strategy-title">
                <h2 id="db-strategy-title" className="db-panel-title">策略表现</h2>
                <table className="db-strats">
                  <thead><tr><th scope="col">策略</th><th scope="col">笔数</th><th scope="col">胜率</th><th scope="col">净盈亏</th></tr></thead>
                  <tbody>
                    {stats.strategies.map((strategy) => {
                      const link = (
                        <Link to={strategyAnalysisHref(strategy.id, scope, strategyLiveStage)} className="db-strat">
                          {strategy.meta && <StrategyIcon icon={strategy.meta.icon} color={strategy.meta.color} size={ICON_SM} variant="nav" />}
                          <span>{strategy.name}</span>
                        </Link>
                      )
                      const partial = strategy.pnlCount !== strategy.closedCount || strategy.n !== strategy.closedCount
                      const samples = `有效结果 ${strategy.n}/${strategy.closedCount} 笔，计入盈亏 ${strategy.pnlCount}/${strategy.closedCount} 笔`
                      const tone = privacyMode || strategy.pnlCount === 0 || strategy.pnl === 0
                        ? undefined : strategy.pnl > 0 ? 'positive' : 'negative'
                      return (
                        <tr key={strategy.id}>
                          <th scope="row">{partial ? <Tooltip content={samples} label={samples} asChild showOnFocus>{link}</Tooltip> : link}</th>
                          <td>{strategy.closedCount}</td>
                          <td>{rateLabel(strategy.winRate)}</td>
                          <td data-pnl-tone={tone}>
                            {strategy.pnlCount ? fmtMoney(strategy.pnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              <section className="db-panel db-distribution" aria-labelledby="db-distribution-title">
                <div className="db-section-head">
                  <h2 id="db-distribution-title" className="db-panel-title">R 倍数分布</h2>
                  {stats.rCount > 0 && <span>{stats.rCount} 笔</span>}
                </div>
                {stats.rCount === 0 ? (
                  <p className="db-panel-empty">当前范围暂无有效 R 倍数</p>
                ) : (
                  <>
                    <RDistributionChart buckets={stats.rDist} />
                    <details className="db-chart-data">
                      <summary>查看分布数据<DisclosureIcon size={ICON_SM} /></summary>
                      <table aria-label="R 倍数分布数据">
                        <thead><tr><th scope="col">R 区间</th><th scope="col">笔数</th></tr></thead>
                        <tbody>
                          {stats.rDist.map((bucket) => (
                            <tr key={bucket.label}><th scope="row">{bucket.label}</th><td>{bucket.n}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </>
                )}
              </section>
            </div>
          )}

          {!weekCardEmpty && (
            <section className="db-week" aria-label="本周交易分析">
              <div className="db-week-head">
                <div><h2 className="db-week-title">本周交易分析</h2><span>{weekRangeLabel}</span></div>
                <Link to={`/weekly-review${sharedTradeWorkspaceSearch(location.search)}`} className="ui-btn ui-btn-ghost ui-btn-sm">
                  周期复盘<ChevronRight size={ICON_SM} aria-hidden />
                </Link>
              </div>
              <details className="db-week-detail">
                <summary>本周概况<DisclosureIcon size={ICON_SM} /></summary>
                {scope.range !== 'this-week' && (
                  <dl className="db-week-metrics">
                    <div className="db-week-metric"><dt>平仓交易</dt><dd><strong>{weekMetrics.tradeCount}</strong></dd></div>
                    <div className="db-week-metric"><dt>胜率</dt><dd><strong>{rateLabel(weekMetrics.winRate)}</strong></dd></div>
                    <div className="db-week-metric">
                      <dt>净盈亏</dt>
                      <dd><strong>{weekMetrics.pnlCount ? fmtMoney(weekMetrics.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'}</strong></dd>
                    </div>
                    <div className="db-week-metric"><dt>平均 R</dt><dd><strong>{averageRLabel(weekMetrics.averageR)}</strong></dd></div>
                  </dl>
                )}
                <p>{weekMetrics.reviewedCount} 笔已复盘 · {weekMetrics.tradeCount - weekMetrics.reviewedCount} 笔待复盘</p>
                {missedReasonSummary && <p>错过机会 {weekMetrics.missedCount} 笔 · {missedReasonSummary}</p>}
              </details>
            </section>
          )}
        </div>
      </div>
    </>
  )
}

function Metric({ label, value, to, primary = false }: { label: string; value: string; to: string; primary?: boolean }) {
  const numberRef = useValueMotion<HTMLElement>(value)
  return (
    <Link className={primary ? 'db-card is-primary' : 'db-card'} to={to} data-kpi-drilldown>
      <span className="db-card-label">{label}{primary && <small>{PERFORMANCE_REPORT_CURRENCY}</small>}</span>
      <strong ref={numberRef} className="db-card-value">{value}</strong>
    </Link>
  )
}

function rateLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`
}

function averageRLabel(value: number | null): string {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}
