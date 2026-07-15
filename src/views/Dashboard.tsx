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
import { StrategyIcon } from '@/components/StrategyIcon'
import { Plus } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { getStrategyName } from '@/lib/strategies'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { isUsableTradeResult, summarizeTradeResults, validateTradeResultEvidence } from '@/lib/tradeTruth'
import {
  selectAnalyticsCandidates,
  type AnalyticsScope,
  type AnalyticsRange,
  type AnalyticsTradeKind,
} from '@/lib/analyticsScope'
import { buildRDistribution } from '@/lib/rDistribution'
import { buildMistakeTagQuality } from '@/lib/analyticsQuality'
import { aggregateMoney, moneyAggregateLabel, moneyAggregateTitle, type MoneyAggregate } from '@/lib/moneyAggregate'
import { buildTradeAnalytics } from '@/lib/tradeAnalytics'
import { downsampleIndices } from '@/lib/analyticsSeries'
import {
  countDashboardDimensionFilters,
  parseDashboardQuery,
  updateDashboardQuery,
  type DashboardQuality,
  type DashboardQueryKey,
} from '@/lib/dashboardQuery'
import './Dashboard.css'

type TimeRange = AnalyticsRange
type DashboardKind = AnalyticsTradeKind
type TrendMode = 'r' | 'money' | 'rolling20'
type StrategySort = 'configured' | 'totalR' | 'expectancyR' | 'sampleSize'

type CurvePoint = {
  date: string
  value: number
  label: string
  tradeId: string
  ref: string
  result: number
  mode: TrendMode
  currency?: string
}

const RANGE_OPTS: { value: TimeRange; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'this-month', label: '本月' },
  { value: '30d', label: '近30天' },
  { value: '90d', label: '近90天' },
  { value: 'ytd', label: '本年' },
]

const KIND_OPTS: { value: DashboardKind; label: string }[] = [
  { value: 'live', label: '实盘' },
  { value: 'paper', label: '模拟' },
  { value: 'all', label: '实盘 + 模拟' },
]

const QUALITY_OPTS: { value: DashboardQuality; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'missing', label: '待补' },
  { value: 'conflict', label: '冲突' },
  { value: 'confirmed', label: '已确认' },
  { value: 'verified', label: '已交叉验证' },
]

const compactAxisNumber = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function selectDashboardAnalyticsCandidates(
  trades: readonly Trade[],
  kind: DashboardKind,
  range: TimeRange,
  dimensions: Omit<AnalyticsScope, 'tradeKind' | 'range'> = {},
) {
  return selectAnalyticsCandidates(trades, { ...dimensions, tradeKind: kind, range })
}

function closedAtSource(trade: Trade): string {
  return (trade as Trade & { closedAtTimestamp?: string | null }).closedAtTimestamp
    ?? trade.closedAt
    ?? ''
}

export function buildDashboardStats(closed: Trade[], temporal: Trade[], strategyDefs: Strategy[]) {
  const summary = summarizeTradeResults(closed)
  const money = aggregateMoney(closed)
  const usable = closed.filter(isUsableTradeResult)
  const pnlTrades = usable.filter(
    (trade): trade is Trade & { pnl: number } =>
      typeof trade.pnl === 'number' && Number.isFinite(trade.pnl),
  )
  const rTrades = usable.filter(
    (trade): trade is Trade & { rMultiple: number } =>
      typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple),
  )
  const feeCompleteCount = pnlTrades.filter((trade) => trade.costs?.completeness === 'complete').length
  const currencyKnownCount = pnlTrades.filter((trade) => Boolean(trade.pnlCurrency)).length
  const riskCount = usable.filter((trade) =>
    (typeof trade.initialRiskAmount === 'number' && Number.isFinite(trade.initialRiskAmount) && trade.initialRiskAmount > 0) ||
    (
      typeof trade.initialRiskPct === 'number' && Number.isFinite(trade.initialRiskPct) && trade.initialRiskPct > 0 &&
      typeof trade.accountEquityAtEntry === 'number' && Number.isFinite(trade.accountEquityAtEntry) && trade.accountEquityAtEntry > 0
    ),
  ).length
  const sessionCount = usable.filter((trade) => Boolean(trade.session?.trim())).length

  const temporalIds = new Set(temporal.map((trade) => trade.id))
  const sortByClose = (a: Trade, b: Trade) =>
    closedAtSource(a).localeCompare(closedAtSource(b)) || a.ref.localeCompare(b.ref)
  const temporalPnl = pnlTrades
    .filter((trade) => temporalIds.has(trade.id))
    .sort(sortByClose)
  const temporalR = rTrades
    .filter((trade) => temporalIds.has(trade.id))
    .sort(sortByClose)
  const byStrat = new Map<string, Trade[]>()
  closed.forEach((t) => {
    const strategyTrades = byStrat.get(t.strategyId)
    if (strategyTrades) strategyTrades.push(t)
    else byStrat.set(t.strategyId, [t])
  })
  const configuredStrategyIds = strategyDefs.map((strategy) => strategy.id)
  const strategyIds = [
    ...configuredStrategyIds.filter((id) => byStrat.has(id)),
    ...[...byStrat.keys()].filter((id) => !configuredStrategyIds.includes(id)),
  ]
  const strategies = strategyIds
    .map((id) => {
      const strategyTrades = byStrat.get(id) ?? []
      const temporalStrategyTrades = strategyTrades.filter((trade) => temporalIds.has(trade.id))
      return {
        id,
        name: getStrategyName(strategyDefs, id),
        meta: strategyDefs.find((s) => s.id === id),
        analytics: buildTradeAnalytics(strategyTrades, temporalStrategyTrades),
        money: aggregateMoney(strategyTrades),
      }
    })

  const rDist = buildRDistribution(rTrades.map((trade) => trade.rMultiple))

  return {
    ...summary,
    professional: buildTradeAnalytics(closed, temporal),
    money,
    mistakeTagQuality: buildMistakeTagQuality(closed),
    temporalPnl,
    temporalR,
    strategies,
    rDist,
    evidenceSource: closed,
    evidenceCounts: summary.qualityCounts,
    feeCompleteCount,
    currencyKnownCount,
    riskCount,
    sessionCount,
  }
}

export function buildDashboardTrendCurve(
  mode: TrendMode,
  temporalPnl: Array<Trade & { pnl: number }>,
  temporalR: Array<Trade & { rMultiple: number }>,
  money: MoneyAggregate,
): CurvePoint[] {
  let cumulative = 0
  let source: Trade[]
  let results: number[]
  let values: number[]
  let currency: string | undefined
  if (mode === 'money') {
    if (money.state !== 'single-currency') return []
    source = temporalPnl
    results = temporalPnl.map((trade) => trade.pnl)
    values = results.map((result) => {
      cumulative += result
      return cumulative
    })
    currency = money.currency
  } else if (mode === 'rolling20') {
    source = temporalR.slice(19)
    results = source.map((trade) => trade.rMultiple ?? 0)
    let windowTotal = temporalR.slice(0, 20).reduce((sum, trade) => sum + trade.rMultiple, 0)
    values = source.map((_trade, index) => {
      if (index > 0) windowTotal += temporalR[index + 19]!.rMultiple - temporalR[index - 1]!.rMultiple
      return windowTotal / 20
    })
  } else {
    source = temporalR
    results = temporalR.map((trade) => trade.rMultiple)
    values = results.map((result) => {
      cumulative += result
      return cumulative
    })
  }
  return downsampleIndices(values.length, 600, (index) => values[index]!)
    .map((index) => curvePoint(source[index]!, values[index]!, results[index]!, mode, currency))
}

function curvePoint(trade: Trade, value: number, result: number, mode: TrendMode, currency?: string): CurvePoint {
  const closedOn = closedAtSource(trade).slice(0, 10)
  return {
    date: closedOn.slice(5),
    value,
    label: trade.symbol,
    tradeId: trade.id,
    ref: trade.ref,
    result,
    mode,
    currency,
  }
}

export function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [trendMode, setTrendMode] = useState<TrendMode>('r')
  const [strategySort, setStrategySort] = useState<StrategySort>('configured')
  const trades = useStore((s) => s.trades)
  const strategyDefs = useStore((s) => s.strategies)
  const strategyVersions = useStore((s) => s.strategyVersions)
  const openComposer = useStore((s) => s.openComposer)
  const query = useMemo(() => parseDashboardQuery(searchParams), [searchParams])
  const range = query.range
  const kind = query.tradeKind
  const quality = query.quality
  const activeDimensionCount = countDashboardDimensionFilters(query)

  const setQuery = (key: DashboardQueryKey, value: string | null | undefined) => {
    setSearchParams(updateDashboardQuery(searchParams, key, value), { replace: true })
  }
  const clearDimensions = () => {
    const next = new URLSearchParams(searchParams)
    for (const key of [
      'strategy', 'strategyVersion', 'symbol', 'side', 'timeframe',
      'session', 'tag', 'mistakeTag', 'currency',
    ]) next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const filterOptions = useMemo(() => {
    const values = (items: Array<string | null | undefined>) => [...new Set(
      items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)),
    )].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return {
      symbols: values(trades.map((trade) => trade.symbol)),
      timeframes: values(trades.map((trade) => trade.timeframe)),
      sessions: values(trades.map((trade) => trade.session)),
      tags: values(trades.flatMap((trade) => trade.tags)),
      mistakeTags: values(trades.flatMap((trade) => trade.mistakeTags)),
      currencies: values(trades.map((trade) => trade.pnlCurrency)),
    }
  }, [trades])
  const visibleStrategyVersions = useMemo(
    () => strategyVersions.filter(
      (version) => !query.scope.strategyId || version.strategyId === query.scope.strategyId,
    ),
    [strategyVersions, query.scope.strategyId],
  )

  const stats = useMemo(() => {
    const candidates = selectDashboardAnalyticsCandidates(trades, kind, range, query.scope)
    return buildDashboardStats(candidates.included, candidates.temporalCandidates, strategyDefs)
  }, [trades, strategyDefs, range, kind, query.scope])
  useEffect(() => {
    if (trendMode === 'money' && stats.money.state !== 'single-currency') setTrendMode('r')
  }, [stats.money.state, trendMode])
  const evidenceRows = useMemo(
    () => {
      if (quality === 'all') return []
      const rows: Array<{ trade: Trade; validation: ReturnType<typeof validateTradeResultEvidence> }> = []
      for (const trade of stats.evidenceSource) {
        const validation = validateTradeResultEvidence(trade)
        if (validation.quality === quality) rows.push({ trade, validation })
        if (rows.length === 50) break
      }
      return rows
    },
    [quality, stats.evidenceSource],
  )
  const strategyRows = useMemo(() => {
    if (strategySort === 'configured') return stats.strategies
    const value = (strategy: (typeof stats.strategies)[number]) => {
      if (strategySort === 'sampleSize') return strategy.analytics.verifiedCount
      const metric = strategySort === 'totalR' ? strategy.analytics.totalR : strategy.analytics.expectancyR
      return metric.value
    }
    return [...stats.strategies].sort((a, b) => {
      const aValue = value(a)
      const bValue = value(b)
      if (aValue == null) return bValue == null ? a.name.localeCompare(b.name, 'zh-CN') : 1
      if (bValue == null) return -1
      return bValue - aValue || a.name.localeCompare(b.name, 'zh-CN')
    })
  }, [stats.strategies, strategySort])
  const rangeLabel = RANGE_OPTS.find((o) => o.value === range)?.label ?? '全部'
  const kindLabel = KIND_OPTS.find((o) => o.value === kind)?.label ?? '实盘 + 模拟'
  const hasClosedTrades = stats.closedCount > 0
  const hasNonDefaultAnalysisScope = activeDimensionCount > 0 || range !== 'all' || kind !== 'live' || quality !== 'all'
  const curve = useMemo(
    () => buildDashboardTrendCurve(trendMode, stats.temporalPnl, stats.temporalR, stats.money),
    [trendMode, stats.temporalPnl, stats.temporalR, stats.money],
  )
  const trendTitle = trendMode === 'r'
    ? '累计 R 曲线'
    : trendMode === 'money'
      ? `${moneyAggregateTitle(stats.money)}曲线`
      : '滚动 20 笔期望 R'

  const openTrade = (tradeId: string) => {
    const t = trades.find((x) => x.id === tradeId)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`, {
      state: tradeDetailNavState({
        pathname: location.pathname,
        search: location.search,
        anchorTradeId: tradeId,
      }),
    })
  }

  return (
    <>
      <Topbar title="仪表盘" subtitle="仅统计已平仓 · 按平仓日累计 · 默认实盘" showDisplay={false} />
      <div className="db-scroll">
        <div className="db-toolbar">
          <span className="db-toolbar-label">分析范围</span>
          <div className="db-segmented" role="tablist" aria-label="交易类型">
            {KIND_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={kind === o.value}
                className={'db-seg' + (kind === o.value ? ' is-on' : '')}
                onClick={() => setQuery('kind', o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="db-segmented" role="tablist" aria-label="时间范围">
            {RANGE_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={range === o.value}
                className={'db-seg' + (range === o.value ? ' is-on' : '')}
                onClick={() => setQuery('range', o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <details className="db-filter-details" open={activeDimensionCount > 0}>
          <summary>
            <span>细分条件{activeDimensionCount > 0 ? ` · ${activeDimensionCount}` : ''}</span>
            <span>筛选会写入网址，可复制后恢复同一分析口径</span>
          </summary>
          <div className="db-filter-grid">
            <FilterSelect label="策略" value={query.scope.strategyId} onChange={(value) => setQuery('strategy', value)}>
              {strategyDefs.map((strategy) => <option value={strategy.id} key={strategy.id}>{strategy.name}</option>)}
            </FilterSelect>
            <FilterSelect label="策略版本" value={query.scope.strategyVersionId} onChange={(value) => setQuery('strategyVersion', value)}>
              {visibleStrategyVersions.map((version) => <option value={version.id} key={version.id}>{version.label}</option>)}
            </FilterSelect>
            <FilterSelect label="品种" value={query.scope.symbol} onChange={(value) => setQuery('symbol', value)}>
              {filterOptions.symbols.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect label="方向" value={query.scope.side} onChange={(value) => setQuery('side', value)}>
              <option value="long">多</option><option value="short">空</option>
            </FilterSelect>
            <FilterSelect label="周期" value={query.scope.timeframe} onChange={(value) => setQuery('timeframe', value)}>
              {filterOptions.timeframes.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect label="时段" value={query.scope.session} onChange={(value) => setQuery('session', value)}>
              {filterOptions.sessions.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect label="标签" value={query.scope.tag} onChange={(value) => setQuery('tag', value)}>
              {filterOptions.tags.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect label="错误标签" value={query.scope.mistakeTag} onChange={(value) => setQuery('mistakeTag', value)}>
              {filterOptions.mistakeTags.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect label="币种" value={query.scope.currency} onChange={(value) => setQuery('currency', value)}>
              {filterOptions.currencies.map((value) => <option value={value} key={value}>{value}</option>)}
            </FilterSelect>
            {activeDimensionCount > 0 && <button type="button" className="db-filter-clear" onClick={clearDimensions}>清除细分条件</button>}
          </div>
        </details>

        <div className="db-cards">
          <Card
            label={moneyAggregateTitle(stats.money)}
            value={moneyAggregateLabel(stats.money)}
            sub={`${stats.pnlCount}/${stats.closedCount} 笔含可用盈亏`}
            accent={stats.money.state !== 'single-currency' || stats.money.total === 0 ? undefined : stats.money.total > 0}
            title="仅合计结果可信且币种一致的金额；不做跨币种换算。"
          />
          <Card
            label="胜率"
            value={stats.professional.winRate.estimate == null ? '—' : `${(stats.professional.winRate.estimate * 100).toFixed(0)}%`}
            sub={stats.professional.winRate.low == null ? '暂无可用结果' : `${stats.professional.winRate.sampleSize}/${stats.closedCount} 笔 · 95% ${(stats.professional.winRate.low * 100).toFixed(0)}–${(stats.professional.winRate.high! * 100).toFixed(0)}%`}
            title="盈利笔数 ÷ 可用结果笔数；保本计入分母，并显示 95% Wilson 区间。"
          />
          <Card
            label="期望 R"
            value={stats.professional.expectancyR.value == null ? '—' : `${stats.professional.expectancyR.value > 0 ? '+' : ''}${stats.professional.expectancyR.value.toFixed(2)}`}
            sub={`${stats.professional.expectancyR.sampleSize}/${stats.closedCount} 笔含 R · 期望值`}
            accent={stats.professional.expectancyR.value == null || stats.professional.expectancyR.value === 0 ? undefined : stats.professional.expectancyR.value > 0}
            title="所有含 R 的可用结果之算术平均；不把缺失 R 当作 0。"
          />
          <Card label="最大回撤" value={stats.professional.maxDrawdownR.value == null ? '—' : `${stats.professional.maxDrawdownR.value.toFixed(2)}R`} sub={`${stats.professional.maxDrawdownR.sampleSize} 笔时序样本 · 最长连亏 ${stats.professional.longestLosingStreak}`} muted title="按平仓时间排列的累计 R 从历史峰值到后续低点的最大跌幅。" />
        </div>

        <div className="db-secondary-metrics" aria-label="次级绩效指标">
          <SecondaryMetric label="总 R" value={formatRMetric(stats.professional.totalR.value)} title="含 R 的可用结果总和。" />
          <SecondaryMetric label="Profit Factor" value={formatProfitFactor(stats.professional.profitFactor)} title="盈利 R 总和 ÷ 亏损 R 绝对值总和；没有亏损样本时不显示无穷大。" />
          <SecondaryMetric label="中位 R" value={formatRMetric(stats.professional.medianR.value)} title="含 R 结果的中位数，比平均值更不受极端交易影响。" />
          <SecondaryMetric label="最大连亏" value={stats.professional.temporalVerifiedCount ? `${stats.professional.longestLosingStreak} 笔` : '—'} title="按平仓时间排列的连续亏损结果；保本会中断连亏。" />
        </div>

        {hasClosedTrades && (
          <div className={'db-data-health' + (stats.conflictCount > 0 ? ' has-conflict' : '')}>
            <div>
              <span className="db-data-health-title">数据完整度</span>
              <span className="db-data-health-copy">
                结果 {stats.evaluatedCount}/{stats.closedCount} · R {stats.rCount}/{stats.evaluatedCount} · 金额 {stats.pnlCount}/{stats.evaluatedCount} · 风险 {stats.riskCount}/{stats.evaluatedCount} · 时段 {stats.sessionCount}/{stats.evaluatedCount} · 费用 {stats.feeCompleteCount}/{stats.pnlCount} · 币种 {stats.currencyKnownCount}/{stats.pnlCount}
              </span>
              {stats.conflictCount > 0 && <span className="db-data-health-state">{stats.conflictCount} 笔冲突需修复</span>}
            </div>
            <div className="db-quality-tabs" aria-label="结果证据质量">
              {QUALITY_OPTS.map((option) => {
                const count = option.value === 'all'
                  ? stats.closedCount
                  : stats.evidenceCounts[option.value]
                return (
                  <button
                    type="button"
                    key={option.value}
                    className={quality === option.value ? 'is-on' : ''}
                    aria-pressed={quality === option.value}
                    onClick={() => setQuery('quality', option.value)}
                  >
                    {option.label} <span>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {hasClosedTrades && quality !== 'all' && (
          <section className="db-evidence-panel" aria-label="结果证据明细">
            <div className="db-evidence-head">
              <div>
                <strong>{QUALITY_OPTS.find((option) => option.value === quality)?.label}交易</strong>
                <span>点击原始记录核对；返回时保留当前全部分析条件。</span>
              </div>
              {stats.evidenceCounts[quality] > evidenceRows.length && (
                <span>显示前 {evidenceRows.length}/{stats.evidenceCounts[quality]} 笔</span>
              )}
            </div>
            <div className="db-evidence-list">
              {evidenceRows.map(({ trade, validation }) => (
                <button type="button" key={trade.id} onClick={() => openTrade(trade.id)}>
                  <span className="db-evidence-ref">{trade.ref}</span>
                  <strong>{trade.symbol}</strong>
                  <span>{getStrategyName(strategyDefs, trade.strategyId)}</span>
                  <span className="db-evidence-issue">
                    {validation.issues[0]?.message ?? (validation.quality === 'verified' ? '金额与风险或费用证据一致' : '结果可用，但尚无第二证据交叉校验')}
                  </span>
                  <span className="db-evidence-result">
                    {typeof trade.pnl === 'number' ? fmtMoney(trade.pnl) : '—'} · {typeof trade.rMultiple === 'number' ? `${trade.rMultiple > 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R` : '—'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!hasClosedTrades ? (
          <EmptyState
            title={hasNonDefaultAnalysisScope ? '当前分析条件下没有已平仓交易' : '还没有已平仓交易'}
            hint={hasNonDefaultAnalysisScope ? '分析条件已保留；可以调整条件或清除后查看默认范围。' : '平仓并填写结果后，这里会生成可信度指标、趋势与策略表现。'}
            action={
              hasNonDefaultAnalysisScope ? (
                <button type="button" className="empty-btn" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                  清除分析条件
                </button>
              ) : trades.length > 0 ? (
                <button type="button" className="empty-btn" onClick={() => navigate('/active')}>
                  查看进行中交易
                </button>
              ) : (
                <button type="button" className="empty-btn" onClick={() => openComposer()}>
                  <Plus size={15} />
                  新建交易
                </button>
              )
            }
          />
        ) : (
          <>
        <section className="db-panel">
          <div className="db-panel-head">
            <div>
              <span className="db-panel-title">{trendTitle}</span>
              <div className="db-panel-sub">
                {stats.closedCount} 笔已平仓 · {kindLabel} · {rangeLabel}
              </div>
            </div>
            <div className="db-trend-actions">
              <div className="db-segmented db-trend-switch" role="tablist" aria-label="趋势指标">
                <button type="button" role="tab" aria-selected={trendMode === 'r'} className={'db-seg' + (trendMode === 'r' ? ' is-on' : '')} onClick={() => setTrendMode('r')}>累计 R</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={trendMode === 'money'}
                  className={'db-seg' + (trendMode === 'money' ? ' is-on' : '')}
                  disabled={stats.money.state !== 'single-currency'}
                  title={stats.money.state === 'single-currency' ? `仅合计 ${stats.money.currency}` : moneyAggregateLabel(stats.money)}
                  onClick={() => setTrendMode('money')}
                >
                  盈亏
                </button>
                <button type="button" role="tab" aria-selected={trendMode === 'rolling20'} className={'db-seg' + (trendMode === 'rolling20' ? ' is-on' : '')} onClick={() => setTrendMode('rolling20')}>滚动 20</button>
              </div>
              {curve.length > 0 && <span className="db-panel-hint">悬停或点击数据点查看交易</span>}
            </div>
          </div>
          <div className="db-chart">
            {curve.length === 0 ? (
              <div className="db-chart-empty">
                {trendMode === 'rolling20' ? '至少需要 20 笔含 R 的时序交易' : trendMode === 'money' ? moneyAggregateLabel(stats.money) : '该时间范围内暂无含 R 的时序交易'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={curve} margin={{ left: 0, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    width={56}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    tickFormatter={(value: number) => compactAxisNumber.format(value)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<CurveTooltip onOpen={openTrade} />}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    isAnimationActive={false}
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#eq)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      cursor: 'pointer',
                      onClick: (_e, dot) => {
                        const p = (dot as { payload?: CurvePoint }).payload
                        if (p?.tradeId) openTrade(p.tradeId)
                      },
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">策略表现</span>
            <label className="db-strategy-sort">
              <span>排序</span>
              <select value={strategySort} onChange={(event) => setStrategySort(event.target.value as StrategySort)}>
                <option value="configured">默认顺序</option>
                <option value="totalR">总 R</option>
                <option value="expectancyR">期望 R</option>
                <option value="sampleSize">样本数</option>
              </select>
            </label>
          </div>
          <div className="db-strats">
            {stats.strategies.length === 0 ? (
              <div className="db-strats-empty">该时间范围内暂无策略数据</div>
            ) : (
              strategyRows.map((s) => (
                <Link to={`/strategy/${s.id}`} className="db-strat" key={s.id}>
                  <div className="db-strat-head">
                    {s.meta && (
                      <StrategyIcon icon={s.meta.icon} color={s.meta.color} size={16} />
                    )}
                    <div className="db-strat-name">{s.name}</div>
                  </div>
                  <div className="db-strat-meta">
                    {s.analytics.verifiedCount}/{s.analytics.closedCount} 笔结果有效
                  </div>
                  <div className="db-strat-metrics">
                    <Metric label="期望 R" value={formatRMetric(s.analytics.expectancyR.value)} title="策略内所有含 R 的可用结果之平均。" />
                    <Metric label="累计 R" value={formatRMetric(s.analytics.totalR.value)} title="样本内总 R 贡献，不代表单笔交易优势。" />
                    <Metric
                      label="胜率 · 95% 区间"
                      value={s.analytics.winRate.estimate == null
                        ? '—'
                        : `${formatPercent(s.analytics.winRate.estimate)} · ${formatPercent(s.analytics.winRate.low!)}–${formatPercent(s.analytics.winRate.high!)}`}
                      title="盈利笔数 ÷ 可用结果笔数；保本计入分母。"
                    />
                    <Metric
                      label="金额覆盖"
                      value={`${s.money.sampleSize}/${s.analytics.verifiedCount}`}
                      title={moneyAggregateLabel(s.money)}
                    />
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
              <div className="db-chart-empty">该时间范围内暂无已平仓交易</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={stats.rDist} margin={{ left: -16, right: 8, top: 4 }}>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'color-mix(in srgb, var(--bg-hover) 88%, transparent)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as { label: string; count: number }
                      return (
                        <div className="db-chart-tip db-chart-tip--compact">
                          <div className="db-chart-tip-ref">R 倍数区间</div>
                          <div className="db-chart-tip-symbol">{d.label}</div>
                          <div className="db-chart-tip-row">
                            <span>笔数</span>
                            <strong>{d.count}</strong>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar
                    dataKey="count"
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
            )}
          </div>
        </section>

        <section className="db-panel">
          <div className="db-panel-head">
            <div>
              <span className="db-panel-title">质量归因</span>
              <div className="db-panel-sub">错误标签只用于定位模式，不代表因果结论；样本量与结果覆盖率同时显示。</div>
            </div>
          </div>
          <div className="db-strats">
            {stats.mistakeTagQuality.length === 0 ? (
              <div className="db-strats-empty">暂无错误标签样本</div>
            ) : stats.mistakeTagQuality.slice(0, 5).map((slice) => (
              <div className="db-strat" key={slice.key}>
                <div className="db-strat-head"><div className="db-strat-name">{slice.label}</div></div>
                <div className="db-strat-meta">
                  {slice.count} 笔 · {slice.metrics.resultCount}/{slice.metrics.closedCount} 笔结果可用
                </div>
                <div className="db-strat-pnl">
                  期望 R {slice.metrics.expectancyR.value == null ? '—' : slice.metrics.expectancyR.value.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </section>
          </>
        )}
      </div>
    </>
  )
}

function CurveTooltip({
  active,
  payload,
  onOpen,
}: {
  active?: boolean
  payload?: Array<{ payload: CurvePoint }>
  onOpen: (tradeId: string) => void
}) {
  if (!active || !payload?.[0]) return null
  const p = payload[0].payload
  const formatValue = (value: number) => p.mode === 'money'
    ? `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${p.currency ?? ''}`.trim()
    : `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
  const resultLabel = p.mode === 'money' ? '单笔盈亏' : '单笔 R'
  const valueLabel = p.mode === 'rolling20' ? '最近 20 笔均值' : p.mode === 'money' ? '累计盈亏' : '累计 R'
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
        <span>{resultLabel}</span>
        <span style={{ color: p.result >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatValue(p.result)}</span>
      </div>
      <div className="db-chart-tip-row">
        <span>{valueLabel}</span>
        <span>{formatValue(p.value)}</span>
      </div>
      <div className="db-chart-tip-hint">点击查看交易</div>
    </div>
  )
}

function formatRMetric(value: number | null): string {
  if (value == null) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

function formatProfitFactor(value: ReturnType<typeof buildTradeAnalytics>['profitFactor']): string {
  if (value.state === 'no-data') return '—'
  if (value.state === 'no-losses') return '无亏损样本'
  return value.value == null ? '—' : value.value.toFixed(2)
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="db-strat-metric" title={title}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function SecondaryMetric({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span className="db-secondary-metric" title={title}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value?: string
  onChange: (value: string | null) => void
  children: ReactNode
}) {
  return (
    <label className="db-filter-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">不限</option>
        {children}
      </select>
    </label>
  )
}

function Card({
  label,
  value,
  sub,
  accent,
  muted,
  title,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  muted?: boolean
  title?: string
}) {
  const color = muted
    ? 'var(--text-primary)'
    : accent === undefined
      ? 'var(--text-primary)'
      : accent
        ? 'var(--pos)'
        : 'var(--neg)'
  return (
    <div className="db-card" title={title}>
      <span className="db-card-label">{label}</span>
      <span className="db-card-value" style={{ color }}>
        {value}
      </span>
      {sub && <span className="db-card-sub">{sub}</span>}
    </div>
  )
}
