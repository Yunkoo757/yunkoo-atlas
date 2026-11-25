import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type DashboardCurvePoint, type DashboardRBucket } from '@/lib/dashboardStats'
import { fmtMoney } from '@/lib/format'
import { PERFORMANCE_REPORT_CURRENCY } from '@/lib/performanceSelection'
import { ChevronRight } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 'var(--type-caption-size)' }
const USD_AXIS = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  style: 'currency',
  currency: PERFORMANCE_REPORT_CURRENCY,
  maximumFractionDigits: 1,
})
const COUNT_AXIS = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function EquityChart({
  curve,
  privacyMode,
  onOpenTrade,
}: {
  curve: DashboardCurvePoint[]
  privacyMode: boolean
  onOpenTrade: (id: string) => void
}) {
  const { series, dateTicks, showYear } = useMemo(() => {
    const series = curve.map((point, index) => ({ ...point, index }))
    const days = series.filter((point) => point.index === 0 || point.date !== series[point.index - 1].date)
    const ticks = days.length <= 6 ? days : Array.from({ length: 6 }, (_, index) =>
      days[Math.round(index * (days.length - 1) / 5)],
    )
    return {
      series,
      dateTicks: ticks.map((point) => point.index),
      showYear: days[0]?.date.slice(0, 4) !== days.at(-1)?.date.slice(0, 4),
    }
  }, [curve])
  const hasNegativeEquity = curve.some((point) => point.equity < 0)
  const hasPositiveEquity = curve.some((point) => point.equity > 0)
  const [chartRef, axisWidth] = useEquityAxisWidth(curve, privacyMode)

  if (!series.length) {
    return <p className="db-chart-empty">暂无可用于曲线的美元盈亏</p>
  }

  return (
    <div className="db-chart db-equity-chart" ref={chartRef} aria-label="累计盈亏曲线">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart accessibilityLayer data={series} margin={{ top: 8, right: 12, left: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            type="number"
            dataKey="index"
            domain={series.length === 1 ? [-1, 1] : [0, series.length - 1]}
            ticks={dateTicks}
            tickFormatter={(value: number) => {
              const day = series[value]?.date ?? ''
              return showYear ? day : day.slice(5)
            }}
            interval="preserveStartEnd"
            minTickGap={24}
            padding={{ left: 22, right: 22 }}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={axisWidth}
            hide={privacyMode}
            tickCount={5}
            domain={[hasNegativeEquity ? 'auto' : 0, hasNegativeEquity && !hasPositiveEquity ? 0 : 'auto']}
            tickFormatter={(value: number) => USD_AXIS.format(value)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine y={0} stroke="var(--border-default)" />
          <Tooltip
            isAnimationActive={false}
            content={<CurveTooltip privacyMode={privacyMode} onOpenTrade={onOpenTrade} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          />
          <Area
            type="linear"
            dataKey="equity"
            baseValue={0}
            isAnimationActive={false}
            stroke="var(--chart-series)"
            strokeWidth={2}
            fill="var(--chart-series)"
            fillOpacity={0.10}
            dot={series.length === 1 ? { r: 3, strokeWidth: 1, fill: 'var(--surface-elevated)' } : false}
            activeDot={{
              r: 4,
              fill: 'var(--chart-series)',
              stroke: 'var(--surface-elevated)',
              cursor: 'pointer',
              onClick: (_event, dot) => {
                const point = (dot as { payload?: DashboardCurvePoint }).payload
                if (point) onOpenTrade(point.tradeId)
              },
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RDistributionChart({ buckets }: { buckets: DashboardRBucket[] }) {
  return (
    <div className="db-chart db-distribution-chart" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 4, right: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            ticks={['<-3', '0~0.5', '≥10']}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={36}
            tickCount={4}
            tickFormatter={(value: number) => COUNT_AXIS.format(value)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--bg-hover)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const bucket = payload[0].payload as DashboardRBucket
              return (
                <div className="db-chart-tip db-bin-tip">
                  <span>{bucket.label} R</span>
                  <strong>{bucket.n} 笔</strong>
                </div>
              )
            }}
          />
          <Bar
            dataKey="n"
            fill="var(--chart-series)"
            fillOpacity={0.78}
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
            activeBar={{ fill: 'var(--chart-series)', fillOpacity: 1 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function CurveTooltip({
  active,
  payload,
  privacyMode,
  onOpenTrade,
}: {
  active?: boolean
  payload?: Array<{ payload: DashboardCurvePoint }>
  privacyMode: boolean
  onOpenTrade: (id: string) => void
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <button
      className="db-chart-tip db-curve-tip"
      type="button"
      onClick={() => onOpenTrade(point.tradeId)}
      aria-label={`查看交易 ${point.label} ${point.ref}`}
    >
      <span className="db-curve-tip-heading">
        <strong>{point.label}</strong>
        <ChevronRight size={ICON_SM} aria-hidden />
      </span>
      <span className="db-curve-tip-meta">{point.date} · {point.ref}</span>
      <span className="db-chart-tip-row"><span>单笔</span><strong>{fmtMoney(point.pnl, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</strong></span>
      <span className="db-chart-tip-row"><span>累计</span><strong>{fmtMoney(point.equity, PERFORMANCE_REPORT_CURRENCY, privacyMode)}</strong></span>
    </button>
  )
}

/** Recharts accepts a numeric gutter. Measure the compact financial labels after fonts settle. */
function useEquityAxisWidth(curve: DashboardCurvePoint[], hidden: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(52)

  useLayoutEffect(() => {
    const chart = ref.current
    if (!chart || hidden) return
    let frame = 0
    let disposed = false
    const measure = () => {
      frame = 0
      const labels = chart.querySelectorAll<SVGTextElement>('.recharts-yAxis .recharts-cartesian-axis-tick-value')
      if (!labels.length) return
      const longest = Math.max(...Array.from(labels, (label) => label.getBBox().width))
      setWidth(Math.max(44, Math.ceil(longest + 16)))
    }
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(chart)
    schedule()
    void document.fonts.ready.then(schedule)
    return () => {
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [curve, hidden])

  return [ref, width] as const
}
