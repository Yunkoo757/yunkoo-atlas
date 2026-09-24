import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeeklyReviewTrendPoint } from '@/data/weeklyReviews'

export function WeeklyReviewScoreChart({ data }: { data: WeeklyReviewTrendPoint[] }) {
  return (
    <div className="wr-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="week" stroke="var(--border-subtle)" tick={{ fill: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)' }} />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            stroke="var(--border-subtle)"
            tick={{ fill: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)' }}
            width={24}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover-bg)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-8)',
              fontSize: 'var(--type-row-size)',
            }}
            labelStyle={{ color: 'var(--text-strong)' }}
            itemStyle={{ color: 'var(--text-body)' }}
          />
          <Line
            type="monotone"
            dataKey="score"
            name="平均评分"
            stroke="var(--accent)"
            strokeWidth={2}
            connectNulls
            isAnimationActive={false}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
