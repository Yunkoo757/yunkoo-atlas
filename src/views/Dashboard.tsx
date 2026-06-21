import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Topbar } from '@/components/Topbar'
import { StrategyIcon } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import { getStrategyName } from '@/lib/strategies'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { tradeDetailPath } from '@/lib/tradeRoute'
import './Dashboard.css'

type TimeRange = 'all' | '30d' | '90d' | 'ytd'
type DashboardKind = 'live' | 'paper' | 'all'

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
  if (kind === 'all') return trades.filter(isClosed)
  return trades.filter((t) => t.tradeKind === kind && isClosed(t))
}

function filterByRange(trades: Trade[], range: TimeRange): Trade[] {
  const closed = trades.filter(isClosed)
  if (range === 'all') return closed

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

function buildStats(closed: Trade[], strategyDefs: Strategy[]) {
  const wins = closed.filter((t) => t.pnl > 0)
  const total = closed.reduce((s, t) => s + t.pnl, 0)
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
  const avgR =
    closed.length ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0

  const sorted = [...closed].sort(
    (a, b) =>
      +new Date(a.closedAt ?? a.openedAt) - +new Date(b.closedAt ?? b.openedAt),
  )
  let cum = 0
  const curve: CurvePoint[] = sorted.map((t) => {
    cum += t.pnl
    const closedOn = (t.closedAt ?? t.openedAt).slice(0, 10)
    return {
      date: closedOn.slice(5),
      equity: cum,
      label: t.symbol,
      tradeId: t.id,
      ref: t.ref,
      pnl: t.pnl,
    }
  })

  const byStrat = new Map<string, { pnl: number; n: number; wins: number; id: string }>()
  closed.forEach((t) => {
    const e = byStrat.get(t.strategyId) ?? { pnl: 0, n: 0, wins: 0, id: t.strategyId }
    e.pnl += t.pnl
    e.n += 1
    if (t.pnl > 0) e.wins += 1
    byStrat.set(t.strategyId, e)
  })
  const strategies = [...byStrat.entries()]
    .map(([id, v]) => ({
      ...v,
      name: getStrategyName(strategyDefs, id),
      meta: strategyDefs.find((s) => s.id === id),
      winRate: v.n ? (v.wins / v.n) * 100 : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl)
  const maxAbs = Math.max(1, ...strategies.map((s) => Math.abs(s.pnl)))

  return { total, winRate, avgR, count: closed.length, curve, strategies, maxAbs }
}

export function Dashboard() {
  const navigate = useNavigate()
  const trades = useStore((s) => s.trades)
  const strategyDefs = useStore((s) => s.strategies)
  const [range, setRange] = useState<TimeRange>('all')
  const [kind, setKind] = useState<DashboardKind>('live')

  const stats = useMemo(() => {
    const byKind = filterByKind(trades, kind)
    return buildStats(filterByRange(byKind, range), strategyDefs)
  }, [trades, strategyDefs, range, kind])
  const rangeLabel = RANGE_OPTS.find((o) => o.value === range)?.label ?? '全部'
  const kindLabel = KIND_OPTS.find((o) => o.value === kind)?.label ?? '全部类型'

  const openTrade = (tradeId: string) => {
    const t = trades.find((x) => x.id === tradeId)
    navigate(t ? tradeDetailPath(t) : `/trade/${tradeId}`)
  }

  return (
    <>
      <Topbar title="仪表盘" subtitle="仅统计已平仓 · 按平仓日累计 · 默认实盘" showDisplay={false} />
      <div className="db-scroll">
        <div className="db-toolbar">
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
          <Card label="净盈亏" value={fmtMoney(stats.total)} sub="已平仓累计" accent={stats.total >= 0} />
          <Card label="胜率" value={stats.winRate.toFixed(0) + '%'} sub={`${stats.count} 笔已平`} />
          <Card label="平均 R" value={(stats.avgR >= 0 ? '+' : '') + stats.avgR.toFixed(2)} sub="每笔风险回报" accent={stats.avgR >= 0} />
          <Card label="盈利笔数" value={String(Math.round((stats.winRate / 100) * stats.count))} sub={`共 ${stats.count} 笔`} muted />
        </div>

        <section className="db-panel">
          <div className="db-panel-head">
            <div>
              <span className="db-panel-title">累计盈亏曲线</span>
              <div className="db-panel-sub">
                {stats.count} 笔已平仓 · {kindLabel} · {rangeLabel}
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
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#eq)"
                    dot={{ r: 2.5, strokeWidth: 1, fill: 'var(--bg-elevated)' }}
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
                  <div className="db-strat-meta">{s.n} 笔 · 胜率 {s.winRate.toFixed(0)}%</div>
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
