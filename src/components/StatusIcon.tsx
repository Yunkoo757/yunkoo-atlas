import type { TradeStatus, Conviction } from '@/data/trades'

// Linear 风格状态圈：用 SVG 描边圆 + 扇形进度还原（原创绘制）。
const STATUS_COLOR: Record<TradeStatus, string> = {
  planned: 'var(--text-tertiary)',
  open: '#f2c94c',
  missed: '#f2994a',
  win: 'var(--pos)',
  breakeven: 'var(--text-secondary)',
  loss: 'var(--neg)',
}

export function StatusIcon({
  status,
  size = 14,
}: {
  status: TradeStatus
  size?: number
}) {
  const c = STATUS_COLOR[status]
  const r = 6
  const cx = 7
  const cy = 7
  const circ = 2 * Math.PI * r

  // 已平仓状态画实心勾，进行中画 3/4 扇形，计划中画虚线圈
  if (status === 'win' || status === 'loss' || status === 'breakeven') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={r} fill={c} fillOpacity={0.25} />
        {status === 'win' && (
          <path
            d="M4.5 7.2l1.8 1.8 3.2-3.6"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {status === 'loss' && (
          <path
            d="M5 5l4 4M9 5l-4 4"
            stroke={c}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}
        {status === 'breakeven' && (
          <path d="M4.5 7h5" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        )}
      </svg>
    )
  }

  if (status === 'missed') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-label="错过 · 假设盈亏" role="img">
        <title>错过 · 假设盈亏</title>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.5" />
        <path
          d="M4.8 9.2 L9.2 4.8"
          fill="none"
          stroke={c}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (status === 'open') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.5" />
        <circle
          cx={cx}
          cy={cy}
          r={r / 2}
          fill="none"
          stroke={c}
          strokeWidth={r}
          strokeDasharray={`${circ * 0.55} ${circ}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
    )
  }

  // planned —— 虚线圆
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={c}
        strokeWidth="1.5"
        strokeDasharray="1.8 2.2"
      />
    </svg>
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
        <rect x="1" y="1" width="12" height="12" rx="3" fill="#f2994a" />
        <rect x="6.25" y="3.5" width="1.5" height="4.5" rx="0.75" fill="#fff" />
        <rect x="6.25" y="9.5" width="1.5" height="1.5" rx="0.75" fill="#fff" />
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
