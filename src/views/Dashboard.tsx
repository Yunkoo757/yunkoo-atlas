import { useMemo, type ReactNode } from 'react'
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
import { buildAnalyticsMetrics } from '@/lib/analyticsMetrics'
import { buildQualityBreakdown } from '@/lib/analyticsQuality'
import { aggregateMoney, moneyAggregateLabel } from '@/lib/moneyAggregate'
import { buildTradeAnalytics } from '@/lib/tradeAnalytics'
import { downsampleSeries } from '@/lib/analyticsSeries'
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

type CurvePoint = {
  date: string
  equity: number
  label: string
  tradeId: string
  ref: string
  pnl: number
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

function buildStats(closed: Trade[], temporal: Trade[], strategyDefs: Strategy[]) {
  const summary = summarizeTradeResults(closed)
  const metrics = buildAnalyticsMetrics(closed)
  const usable = closed.filter(isUsableTradeResult)
  const evidence = closed.map((trade) => ({
    trade,
    validation: validateTradeResultEvidence(trade),
  }))
  const evidenceCounts = evidence.reduce<Record<Exclude<DashboardQuality, 'all'>, number>>(
    (counts, item) => {
      counts[item.validation.quality] += 1
      return counts
    },
    { missing: 0, conflict: 0, confirmed: 0, verified: 0 },
  )
  const pnlTrades = usable.filter(
    (trade): trade is Trade & { pnl: number } =>
      typeof trade.pnl === 'number' && Number.isFinite(trade.pnl),
  )
  const rTrades = usable.filter(
    (trade): trade is Trade & { rMultiple: number } =>
      typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple),
  )

  const temporalIds = new Set(temporal.map((trade) => trade.id))
  const sorted = pnlTrades
    .filter((trade) => temporalIds.has(trade.id))
    .sort((a, b) => closedAtSource(a).localeCompare(closedAtSource(b)) || a.ref.localeCompare(b.ref))
  let cum = 0
  const curve: CurvePoint[] = sorted.map((t) => {
    cum += t.pnl
    const closedOn = closedAtSource(t).slice(0, 10)
    return {
      date: closedOn.slice(5),
      equity: cum,
      label: t.symbol,
      tradeId: t.id,
      ref: t.ref,
      pnl: t.pnl,
    }
  })

  const byStrat = new Map<string, Trade[]>()
  closed.forEach((t) => {
    const strategyTrades = byStrat.get(t.strategyId)
    if (strategyTrades) strategyTrades.push(t)
    else byStrat.set(t.strategyId, [t])
  })
  const strategies = [...byStrat.entries()]
    .map(([id, strategyTrades]) => {
      const result = summarizeTradeResults(strategyTrades)
      return {
        id,
        pnl: result.totalPnl,
        n: result.evaluatedCount,
        closedCount: result.closedCount,
        wins: result.winCount,
        name: getStrategyName(strategyDefs, id),
        meta: strategyDefs.find((s) => s.id === id),
        winRate: result.winRate,
      }
    })
    .sort((a, b) => b.pnl - a.pnl)
  const maxAbs = Math.max(1, ...strategies.map((s) => Math.abs(s.pnl)))

  const rDist = buildRDistribution(rTrades.map((trade) => trade.rMultiple))

  return {
    ...summary,
    metrics,
    professional: buildTradeAnalytics(closed, temporal),
    money: aggregateMoney(closed),
    quality: buildQualityBreakdown(closed),
    curve: downsampleSeries(curve, 600, (point) => point.equity),
    strategies,
    maxAbs,
    rDist,
    evidence,
    evidenceCounts,
    evidenceVerifiedCount: evidenceCounts.verified,
  }
}

export function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
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
    return buildStats(candidates.included, candidates.temporalCandidates, strategyDefs)
  }, [trades, strategyDefs, range, kind, query.scope])
  const evidenceRows = useMemo(
    () => quality === 'all'
      ? []
      : stats.evidence.filter((item) => item.validation.quality === quality).slice(0, 50),
    [quality, stats.evidence],
  )
  const rangeLabel = RANGE_OPTS.find((o) => o.value === range)?.label ?? '全部'
  const kindLabel = KIND_OPTS.find((o) => o.value === kind)?.label ?? '实盘 + 模拟'
  const hasClosedTrades = stats.closedCount > 0

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
            label="累计盈亏"
            value={moneyAggregateLabel(stats.money)}
            sub={`${stats.metrics.pnl.sampleSize}/${stats.closedCount} 笔含可用盈亏`}
            accent={stats.money.state !== 'single-currency' || stats.money.total === 0 ? undefined : stats.money.total > 0}
          />
          <Card
            label="胜率"
            value={stats.professional.winRate.estimate == null ? '—' : `${(stats.professional.winRate.estimate * 100).toFixed(0)}%`}
            sub={stats.professional.winRate.low == null ? '暂无可用结果' : `${stats.professional.winRate.sampleSize}/${stats.closedCount} 笔 · 95% ${(stats.professional.winRate.low * 100).toFixed(0)}–${(stats.professional.winRate.high! * 100).toFixed(0)}%`}
          />
          <Card
            label="平均 R"
            value={stats.professional.expectancyR.value == null ? '—' : `${stats.professional.expectancyR.value > 0 ? '+' : ''}${stats.professional.expectancyR.value.toFixed(2)}`}
            sub={`${stats.professional.expectancyR.sampleSize}/${stats.closedCount} 笔含 R · 期望值`}
            accent={stats.professional.expectancyR.value == null || stats.professional.expectancyR.value === 0 ? undefined : stats.professional.expectancyR.value > 0}
          />
          <Card label="最大回撤" value={stats.professional.maxDrawdownR.value == null ? '—' : `${stats.professional.maxDrawdownR.value.toFixed(2)}R`} sub={`${stats.professional.maxDrawdownR.sampleSize} 笔时序样本 · 最长连亏 ${stats.professional.longestLosingStreak}`} muted />
        </div>

        {hasClosedTrades && (
          <div className={'db-data-health' + (stats.conflictCount > 0 ? ' has-conflict' : '')}>
            <div>
              <span className="db-data-health-title">数据完整度</span>
              <span className="db-data-health-copy">
                盈亏 {stats.pnlCount}/{stats.closedCount} · R {stats.rCount}/{stats.closedCount} · 已交叉验证 {stats.evidenceVerifiedCount}
              </span>
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
            title="还没有已平仓交易"
            hint="平仓并填写结果后，这里会生成盈亏曲线与策略表现。"
            action={
              trades.length > 0 ? (
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
              <span className="db-panel-title">累计盈亏曲线</span>
              <div className="db-panel-sub">
                {stats.closedCount} 笔已平仓 · {kindLabel} · {rangeLabel}
              </div>
            </div>
            {stats.curve.length > 0 && (
              <span className="db-panel-hint">悬停或点击数据点查看交易</span>
            )}
          </div>
          <div className="db-chart">
            {stats.curve.length === 0 ? (
              <div className="db-chart-empty">该时间范围内暂无已平仓交易</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={stats.curve} margin={{ left: 0, right: 8, top: 8 }}>
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
                    dataKey="equity"
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
          </div>
          <div className="db-strats">
            {stats.strategies.length === 0 ? (
              <div className="db-strats-empty">该时间范围内暂无策略数据</div>
            ) : (
              stats.strategies.map((s) => (
                <Link to={`/strategy/${s.id}`} className="db-strat" key={s.id}>
                  <div className="db-strat-head">
                    {s.meta && (
                      <StrategyIcon icon={s.meta.icon} color={s.meta.color} size={16} />
                    )}
                    <div className="db-strat-name">{s.name}</div>
                  </div>
                  <div className="db-strat-meta">
                    {s.n}/{s.closedCount} 笔结果有效 · 胜率 {s.winRate == null ? '—' : `${s.winRate.toFixed(0)}%`}
                  </div>
                  <div className="db-strat-bar">
                    <div
                      className="db-strat-fill"
                      style={{
                        width: `${(Math.abs(s.pnl) / stats.maxAbs) * 100}%`,
                        background: s.pnl >= 0 ? 'var(--pos)' : 'var(--neg)',
                      }}
                    />
                  </div>
                  <div
                    className="db-strat-pnl"
                    style={{ color: s.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                  >
                    {fmtMoney(s.pnl)}
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
            {stats.quality.byMistakeTag.length === 0 ? (
              <div className="db-strats-empty">暂无错误标签样本</div>
            ) : stats.quality.byMistakeTag.slice(0, 5).map((slice) => (
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
        <span style={{ color: p.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtMoney(p.pnl)}</span>
      </div>
      <div className="db-chart-tip-row">
        <span>累计</span>
        <span>{fmtMoney(p.equity)}</span>
      </div>
      <div className="db-chart-tip-hint">点击查看交易</div>
    </div>
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
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  muted?: boolean
}) {
  const color = muted
    ? 'var(--text-primary)'
    : accent === undefined
      ? 'var(--text-primary)'
      : accent
        ? 'var(--pos)'
        : 'var(--neg)'
  return (
    <div className="db-card">
      <span className="db-card-label">{label}</span>
      <span className="db-card-value" style={{ color }}>
        {value}
      </span>
      {sub && <span className="db-card-sub">{sub}</span>}
    </div>
  )
}
