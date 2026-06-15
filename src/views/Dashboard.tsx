import { useMemo } from 'react'
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
import { useStore } from '@/store/useStore'
import { fmtMoney } from '@/lib/format'
import './Dashboard.css'

export function Dashboard() {
  const trades = useStore((s) => s.trades)

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status !== 'planned' && t.status !== 'open')
    const wins = closed.filter((t) => t.pnl > 0)
    const total = closed.reduce((s, t) => s + t.pnl, 0)
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
    const avgR =
      closed.length ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0

    const sorted = [...closed].sort(
      (a, b) => +new Date(a.openedAt) - +new Date(b.openedAt),
    )
    let cum = 0
    const curve = sorted.map((t) => {
      cum += t.pnl
      return { date: t.openedAt.slice(5), equity: cum, label: t.symbol }
    })

    // 按策略汇总
    const byStrat = new Map<string, { pnl: number; n: number; wins: number }>()
    closed.forEach((t) => {
      const e = byStrat.get(t.strategy) ?? { pnl: 0, n: 0, wins: 0 }
      e.pnl += t.pnl
      e.n += 1
      if (t.pnl > 0) e.wins += 1
      byStrat.set(t.strategy, e)
    })
    const strategies = [...byStrat.entries()]
      .map(([name, v]) => ({ name, ...v, winRate: v.n ? (v.wins / v.n) * 100 : 0 }))
      .sort((a, b) => b.pnl - a.pnl)
    const maxAbs = Math.max(1, ...strategies.map((s) => Math.abs(s.pnl)))

    return { total, winRate, avgR, count: closed.length, curve, strategies, maxAbs }
  }, [trades])

  return (
    <>
      <Topbar title="仪表盘" />
      <div className="db-scroll">
        <div className="db-cards">
          <Card label="净盈亏" value={fmtMoney(stats.total)} sub="已平仓累计" accent={stats.total >= 0} />
          <Card label="胜率" value={stats.winRate.toFixed(0) + '%'} sub={`${stats.count} 笔已平`} />
          <Card label="平均 R" value={(stats.avgR >= 0 ? '+' : '') + stats.avgR.toFixed(2)} sub="每笔风险回报" accent={stats.avgR >= 0} />
          <Card label="盈利笔数" value={String(Math.round((stats.winRate / 100) * stats.count))} sub={`共 ${stats.count} 笔`} muted />
        </div>

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">累计盈亏曲线</span>
          </div>
          <div className="db-chart">
            <ResponsiveContainer width="100%" height={260}>
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
                  contentStyle={{
                    background: 'var(--popover-bg)',
                    border: '0.8px solid var(--popover-border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--popover-shadow)',
                  }}
                  labelStyle={{ color: 'var(--text-tertiary)' }}
                  formatter={(v: number) => [fmtMoney(v), '累计']}
                />
                <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} fill="url(#eq)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="db-panel">
          <div className="db-panel-head">
            <span className="db-panel-title">策略表现</span>
          </div>
          <div className="db-strats">
            {stats.strategies.map((s) => (
              <div className="db-strat" key={s.name}>
                <div className="db-strat-name">{s.name}</div>
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
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
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
