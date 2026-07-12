import type { TradeStatus, Conviction } from '@/data/trades'
import { LinearIssueStatusIcon } from '@/icons/linear'
import type { LinearIssueState } from '@/icons/linear'

const STATUS_COLOR: Record<TradeStatus, string> = {
  planned: 'var(--text-tertiary)',
  open: 'var(--status-open)',
  missed: 'var(--status-missed)',
  win: 'var(--pos)',
  breakeven: 'var(--text-secondary)',
  loss: 'var(--neg)',
}

const STATUS_TO_LINEAR: Record<
  TradeStatus,
  { state: LinearIssueState; progress?: number; title?: string }
> = {
  planned: { state: 'backlog' },
  open: { state: 'started', progress: 0.55 },
  missed: { state: 'canceled', title: '错过 · 假设盈亏' },
  win: { state: 'completed' },
  breakeven: { state: 'duplicate' },
  loss: { state: 'canceled' },
}

export function StatusIcon({
  status,
  size = 14,
}: {
  status: TradeStatus
  size?: number
}) {
  const mapped = STATUS_TO_LINEAR[status]
  return (
    <LinearIssueStatusIcon
      state={mapped.state}
      progress={mapped.progress}
      size={size}
      color={STATUS_COLOR[status]}
      title={mapped.title}
    />
  )
}

// 信心度图标：Linear 优先级风格的三段信号条（原创绘制）。
const BARS: Record<Conviction, number> = { low: 1, medium: 2, high: 3, urgent: 3 }

export function ConvictionIcon({
  conviction,
  size = 14,
}: {
  conviction: Conviction
  size?: number
}) {
  if (conviction === 'urgent') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--status-urgent)" />
        <rect x="6.25" y="3.5" width="1.5" height="4.5" rx="0.75" fill="var(--accent-text)" />
        <rect x="6.25" y="9.5" width="1.5" height="1.5" rx="0.75" fill="var(--accent-text)" />
      </svg>
    )
  }
  const active = BARS[conviction]
  const heights = [4, 7, 10]
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 4.2}
          y={13 - h}
          width="2.6"
          height={h}
          rx="1"
          fill={i < active ? 'var(--text-secondary)' : 'var(--text-quaternary)'}
        />
      ))}
    </svg>
  )
}

// 多空方向小标；quiet 用于列表行（弱描边 + 轻语义字色，与行内标签一致）
export function SideTag({
  side,
  quiet = false,
}: {
  side: 'long' | 'short'
  quiet?: boolean
}) {
  if (quiet) {
    return (
      <span className="side-tag is-quiet" data-side={side}>
        {side === 'long' ? '多' : '空'}
      </span>
    )
  }
  return (
    <span
      className="side-tag"
      style={{
        fontSize: 'var(--fs-micro)',
        fontWeight: 'var(--font-weight-semibold)',
        letterSpacing: '0.02em',
        padding: '1px 5px',
        borderRadius: 'var(--radius-4)',
        color: side === 'long' ? 'var(--pos)' : 'var(--neg)',
        background:
          side === 'long'
            ? 'color-mix(in srgb, var(--pos) 16%, transparent)'
            : 'color-mix(in srgb, var(--neg) 16%, transparent)',
      }}
    >
      {side === 'long' ? '多' : '空'}
    </span>
  )
}
