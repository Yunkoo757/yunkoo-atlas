import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import type { Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { getPeriodBounds, isDateInRange } from '@/lib/periods'
import { isAccountTrade } from '@/lib/tradeKind'
import {
  buildDashboardStats,
  type DashboardCurvePoint,
} from '@/lib/dashboardStats'
import './Dashboard.css'

type TimeRange = 'all' | 'this-month' | '30d' | '90d' | 'ytd'
type DashboardKind = 'live' | 'paper' | 'all'

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
  { value: 'all', label: '全部类型' },
]

function isClosed(t: Trade) {
  return isExecutedClosed(t.status)
}

function filterByKind(trades: Trade[], kind: DashboardKind): Trade[] {
  if (kind === 'all') return trades.filter((t) => isAccountTrade(t) && isClosed(t))
  return trades.filter((t) => t.tradeKind === kind && isClosed(t))
}

function filterByRange(trades: Trade[], range: TimeRange): Trade[] {
  const closed = trades.filter(isClosed)
  if (range === 'all') return closed
  if (range === 'this-month') {
    const bounds = getPeriodBounds('this-month')
    return closed.filter((t) => isDateInRange(t.closedAt ?? t.openedAt, bounds))
  }

  const now = new Date()
  let cutoff: Date
  if (range === 'ytd') {
    cutoff = new Date(now.getFullYear(), 0, 1)
  } else {
    cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - (range === '30d' ? 30 : 90))
  }

  return closed.filter((t) => {
    const d = new Date(t.closedAt ?? t.openedAt)
    return d >= cutoff
  })
}

export function Dashboard() {
  const navigate = useNavigate()
  const allTrades = useStore((s) => s.trades)
  const strategyDefs = useStore((s) => s.strategies)
  const openComposer = useStore((s) => s.openComposer)
  const [range, setRange] = useState<TimeRange>('all')
  const [kind, setKind] = useState<DashboardKind>('live')
  const trades = useMemo(() => allTrades.filter((trade) => !trade.deletedAt), [allTrades])

  const stats = useMemo(() => {
    const byKind = filterByKind(trades, kind)
    return buildDashboardStats(filterByRange(byKind, range), strategyDefs)
  }, [trades, strategyDefs, range, kind])
  const rangeLabel = RANGE_OPTS.find((o) => o.value === range)?.label ?? '全部'
  const kindLabel = KIND_OPTS.find((o) => o.value === kind)?.label ?? '全部类型'
  const hasClosedTrades = stats.closedCount > 0

  const openTrade = (tradeId: string) => {
    const t = trades.find((x) => x.id === tradeId)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`)
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
                onClick={() => setKind(o.value)}
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
                onClick={() => setRange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="db-cards">
          <Card
            label="净盈亏"
            value={fmtMoney(stats.totalPnl)}
            sub={`${stats.pnlCount}/${stats.closedCount} 笔含盈亏`}
            accent={stats.totalPnl === 0 ? undefined : stats.totalPnl > 0}
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
          <Card label="盈利笔数" value={String(stats.winCount)} sub={`共 ${stats.evaluatedCount} 笔有效结果`} muted />
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
              {stats.conflictCount > 0
                ? `${stats.conflictCount} 笔结果冲突`
                : stats.evaluatedCount < stats.closedCount
                  ? `${stats.closedCount - stats.evaluatedCount} 笔待补结果`
                  : '结果完整'}
            </span>
          </div>
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
              <span className="db-panel-hint">悬停查看走势，点击高亮节点打开交易</span>
            )}
          </div>
          <div className="db-chart">
            {stats.curve.length === 0 ? (
              <div className="db-chart-empty">该时间范围内暂无已平仓交易</div>
            ) : (
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
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
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
}: {
  active?: boolean
  payload?: Array<{ payload: DashboardCurvePoint }>
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
