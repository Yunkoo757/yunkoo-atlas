import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { fmtMoney } from '@/lib/format'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { isAccountTrade } from '@/lib/tradeKind'
import { isActive } from '@/lib/tradeStatus'
import {
  filterTradesByAnalysisScope,
  parseAnalysisScope,
  strategyAnalysisHref,
  writeAnalysisScope,
  type AnalysisKind,
  type AnalysisRange,
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
import './Dashboard.css'

const RANGE_OPTS: { value: AnalysisRange; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'this-week', label: '本周' },
  { value: 'this-month', label: '本月' },
  { value: '30d', label: '近30天' },
  { value: '90d', label: '近90天' },
  { value: 'ytd', label: '本年' },
]

const KIND_OPTS: { value: AnalysisKind; label: string }[] = [
  { value: 'live', label: '实盘' },
  { value: 'paper', label: '模拟' },
  { value: 'all', label: '全部类型' },
]

export function Dashboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const allTrades = useStore((s) => s.trades)
  const strategyDefs = useStore((s) => s.strategies)
  const privacyMode = useStore((s) => s.display.privacyMode)
  const openComposer = useStore((s) => s.openComposer)
  const [curveDataOpen, setCurveDataOpen] = useState(false)
  const localDateKey = useLocalDateKey()
  const scope = useMemo(() => parseAnalysisScope(searchParams).scope, [searchParams])
  const trades = useMemo(
    () => filterTradesByAnalysisScope(allTrades, scope),
    [
      allTrades,
      scope.kind,
      scope.range,
      localDateKey,
    ],
  )
  const activeTrades = useMemo(
    () => allTrades.filter((trade) =>
      !trade.deletedAt &&
      isAccountTrade(trade) &&
      isActive(trade.status) &&
      (scope.kind === 'all' || trade.tradeKind === scope.kind),
    ),
    [allTrades, scope.kind],
  )
  const tradeById = useMemo(
    () => new Map(allTrades.filter((trade) => !trade.deletedAt).map((trade) => [trade.id, trade])),
    [allTrades],
  )

  const stats = useMemo(() => buildDashboardStats(trades, strategyDefs), [trades, strategyDefs])
  const weekStart = useMemo(() => weekStartFor(new Date(`${localDateKey}T12:00:00`)), [localDateKey])
  const weekRangeLabel = useMemo(() => formatDashboardWeekRange(weekStart), [weekStart])
  const weekMetrics = useMemo(() => {
    const weekTrades = filterTradesByAnalysisScope(
      allTrades,
      { kind: scope.kind, range: 'this-week' },
      new Date(`${localDateKey}T12:00:00`),
    )
    const missed = scope.kind === 'paper' ? [] : missedTradesInWeek(allTrades, weekStart)
    return buildWeeklyReviewMetrics(weekTrades, missed)
  }, [allTrades, localDateKey, scope.kind, weekStart])
  const rangeLabel = RANGE_OPTS.find((o) => o.value === scope.range)?.label ?? '全部'
  const kindLabel = KIND_OPTS.find((o) => o.value === scope.kind)?.label ?? '全部类型'
  const hasClosedTrades = stats.closedCount > 0
  const activeTradesPath = scope.kind === 'paper' || (
    scope.kind === 'all' && !activeTrades.some((trade) => trade.tradeKind === 'live')
  )
    ? '/sim'
    : '/active'
  const focusingThisWeek = scope.range === 'this-week'
  const missedReasonSummary = Object.entries(weekMetrics.missedReasonCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${MISS_REASON_META[reason as MissReason]?.label ?? '其他'} ×${count}`)
    .join(' · ')

  const updateScope = (patch: Partial<typeof scope>) => {
    setSearchParams(writeAnalysisScope(searchParams, { ...scope, ...patch }), { replace: true })
  }

  const openTrade = (tradeId: string) => {
    const t = tradeById.get(tradeId)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`)
  }

  return (
    <>
      <Topbar title="仪表盘" subtitle="仅统计已平仓 · 按平仓日累计 · 报告币种 USD · 默认实盘" showDisplay={false} />
      <div className="db-scroll">
        <div className="db-toolbar">
          <span className="db-toolbar-label">分析范围</span>
          <div className="db-segmented" role="group" aria-label="交易类型">
            {KIND_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={scope.kind === o.value}
                className={'db-seg' + (scope.kind === o.value ? ' is-on' : '')}
                onClick={() => updateScope({ kind: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="db-segmented" role="group" aria-label="时间范围">
            {RANGE_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={scope.range === o.value}
                className={'db-seg' + (scope.range === o.value ? ' is-on' : '')}
                onClick={() => updateScope({ range: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <section className="db-week" aria-label="本周交易分析">
          <div className="db-week-head">
            <div>
              <span className="db-week-title">本周交易分析</span>
              <div className="db-week-sub">
                {weekRangeLabel} · {kindLabel} · 按平仓日
                {weekMetrics.missedCount > 0 ? ` · 错过 ${weekMetrics.missedCount}` : ''}
              </div>
            </div>
            <div className="db-week-actions">
              {!focusingThisWeek ? (
                <button type="button" className="db-week-link" onClick={() => updateScope({ range: 'this-week' })}>
                  聚焦本周
                </button>
              ) : null}
              {scope.kind !== 'paper' ? (
                <Link to="/weekly-review" className="db-week-link">
                  打开周复盘
                </Link>
              ) : null}
            </div>
          </div>
          <div className="db-week-metrics">
            <div className="db-week-metric">
              <span>平仓</span>
              <strong>{weekMetrics.tradeCount}</strong>
              <small>{weekMetrics.reviewedCount} 笔已复盘</small>
            </div>
            <div className="db-week-metric">
              <span>胜率</span>
              <strong>{weekMetrics.winRate == null ? '—' : `${weekMetrics.winRate.toFixed(0)}%`}</strong>
              <small>
                {weekMetrics.winCount} 赢 · {weekMetrics.lossCount} 亏 · {weekMetrics.breakevenCount} 平
              </small>
            </div>
            <div className="db-week-metric">
              <span>净盈亏</span>
              <strong
                style={{
                  color: privacyMode || weekMetrics.pnlCount === 0 || weekMetrics.totalPnl === 0
                    ? undefined
                    : weekMetrics.totalPnl > 0
                      ? 'var(--pos)'
                      : 'var(--neg)',
                }}
              >
                {weekMetrics.pnlCount === 0 ? '—' : fmtMoney(weekMetrics.totalPnl, privacyMode)}
              </strong>
              <small>{weekMetrics.pnlCount}/{weekMetrics.tradeCount} 笔含盈亏</small>
            </div>
            <div className="db-week-metric">
              <span>平均 R</span>
              <strong
                style={{
                  color: weekMetrics.averageR == null || weekMetrics.averageR === 0
                    ? undefined
                    : weekMetrics.averageR > 0
                      ? 'var(--pos)'
                      : 'var(--neg)',
                }}
              >
                {weekMetrics.averageR == null
                  ? '—'
                  : `${weekMetrics.averageR > 0 ? '+' : ''}${weekMetrics.averageR.toFixed(2)}`}
              </strong>
              <small>{weekMetrics.rCount}/{weekMetrics.tradeCount} 笔含 R</small>
            </div>
          </div>
          {weekMetrics.missedCount > 0 && missedReasonSummary ? (
            <p className="db-week-missed">执行缺口：{missedReasonSummary}</p>
          ) : null}
          {weekMetrics.tradeCount === 0 && weekMetrics.missedCount === 0 ? (
            <p className="db-week-empty">本周尚无已平仓交易。平仓后这里会汇总胜率、盈亏与平均 R。</p>
          ) : null}
        </section>

        <div className="db-cards">
          <Card
            label="净盈亏"
            value={stats.pnlCount === 0 ? '—' : fmtMoney(stats.totalPnl, privacyMode)}
            sub={`${stats.pnlCount}/${stats.closedCount} 笔含盈亏`}
            accent={privacyMode || stats.pnlCount === 0 || stats.totalPnl === 0 ? undefined : stats.totalPnl > 0}
          />
          <Card
            label="胜率"
            value={stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`}
            sub={`${stats.evaluatedCount}/${stats.closedCount} 笔结果有效`}
          />
          <Card
            label="平均 R"
            value={stats.averageR == null ? '—' : `${stats.averageR > 0 ? '+' : ''}${stats.averageR.toFixed(2)}`}
            sub={`${stats.rCount}/${stats.closedCount} 笔含 R`}
            accent={stats.averageR == null || stats.averageR === 0 ? undefined : stats.averageR > 0}
          />
          <Card
            label="盈利笔数"
            value={stats.evaluatedCount === 0 ? '—' : String(stats.winCount)}
            sub={`共 ${stats.evaluatedCount} 笔有效结果`}
            muted
          />
        </div>

        {hasClosedTrades && (
          <div className={'db-data-health' + (stats.conflictCount > 0 ? ' has-conflict' : '')}>
            <div>
              <span className="db-data-health-title">数据完整度</span>
              <span className="db-data-health-copy">
                盈亏 {stats.pnlCount}/{stats.closedCount} · R {stats.rCount}/{stats.closedCount}
              </span>
            </div>
            <span className="db-data-health-state">
              {describeDashboardResultHealth(stats)}
            </span>
          </div>
        )}

        {!hasClosedTrades ? (
          <EmptyState
            className="db-empty"
            title="还没有已平仓交易"
            hint="平仓并填写结果后，这里会生成盈亏曲线与策略表现。"
            action={
              activeTrades.length > 0 ? (
                <button type="button" className="empty-btn" onClick={() => navigate(activeTradesPath)}>
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
              <span className="db-panel-hint">悬停查看走势，或使用下方数据表打开交易</span>
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
                                <Link to={trade ? tradeDetailPath(trade) : `/trade/${point.tradeId}`}>
                                  {point.ref} · {point.label}
                                </Link>
                              </th>
                              <td>{point.date}</td>
                              <td>{fmtMoney(point.pnl, privacyMode)}</td>
                              <td>{fmtMoney(point.equity, privacyMode)}</td>
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

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">策略表现</span>
          </div>
          <div className="db-strats">
            {stats.strategies.length === 0 ? (
              <div className="db-strats-empty">该时间范围内暂无策略数据</div>
            ) : (
              stats.strategies.map((s) => (
                <Link to={strategyAnalysisHref(s.id, scope)} className="db-strat" key={s.id}>
                  <div className="db-strat-head">
                    {s.meta && (
                      <StrategyIcon icon={s.meta.icon} color={s.meta.color} size={16} />
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
                          width: `${(Math.abs(s.pnl) / stats.maxAbs) * 100}%`,
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
                    {s.pnlCount === 0 ? '—' : fmtMoney(s.pnl, privacyMode)}
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
                        <div className="db-chart-tip db-chart-tip--compact">
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
        )}
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
        <span style={{ color: privacyMode ? 'var(--text-tertiary)' : p.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtMoney(p.pnl, privacyMode)}</span>
      </div>
      <div className="db-chart-tip-row">
        <span>累计</span>
        <span>{fmtMoney(p.equity, privacyMode)}</span>
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

function formatDashboardWeekRange(weekStart: string): string {
  const end = weekEndFor(weekStart)
  const left = parseLocalDate(weekStart)
  const right = parseLocalDate(end)
  return left.getMonth() === right.getMonth()
    ? `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getDate()}日`
    : `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getMonth() + 1}月${right.getDate()}日`
}
