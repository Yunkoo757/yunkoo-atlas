import type { TradeStatus, Conviction } from '@/data/trades'
import { ICON_SM } from '@/icons/iconSize'
import './StatusIcon.css'

const STATUS_COLOR: Record<TradeStatus, string> = {
  planned: 'var(--status-planned)',
  open: 'var(--status-open)',
  missed: 'var(--status-missed)',
  win: 'var(--status-win)',
  breakeven: 'var(--status-even)',
  loss: 'var(--status-loss)',
}

export function StatusIcon({ status, size = ICON_SM, animate = true }: {
  status: TradeStatus
  size?: number
  animate?: boolean
}) {
  return (
    <span className="status-icon">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" data-icon-motion="status" data-status={status} data-animate={animate}
        style={{ color: STATUS_COLOR[status] }}>
        <circle className="status-plan" cx="8" cy="8" r="6.25" pathLength="60"
          strokeDasharray="5 5" transform="rotate(-105 8 8)" />
        <circle className="status-ring" cx="8" cy="8" r="6.25" />
        <path className="status-progress" d="M8 3.75a4.25 4.25 0 0 1 0 8.5Z" fill="currentColor" stroke="none" />
        <path className="status-skip" d="M2.5 11.75v-1A4 4 0 0 1 6.5 6.75H13m-3.25-3.25L13 6.75 9.75 10" />
        <circle className="status-disc" cx="8" cy="8" r="7.25" fill="currentColor" stroke="none" />
        <path className="status-result" d="M3.75 8 L6.75 11 L12.5 5.25" />
        <path className="status-cross" d="M5 5 L11 11" pathLength="1" />
      </svg>
    </span>
  )
}

// 四档信心度按亮起的信号条数量区分。
const BARS: Record<Conviction, number> = { low: 1, medium: 2, high: 3, urgent: 4 }
const BAR_HEIGHTS = [4, 6, 8.5, 11]

export function ConvictionIcon({
  conviction,
  size = ICON_SM,
  label,
}: {
  conviction: Conviction
  size?: number
  label?: string
}) {
  const active = BARS[conviction]
  return (
    <svg width={size} height={size} viewBox="0 0 14 14"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 3.3}
          y={13 - h}
          width="2.2"
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
        color: side === 'long' ? 'var(--direction-long-text)' : 'var(--direction-short-text)',
        background:
          side === 'long'
            ? 'var(--direction-long-bg)'
            : 'var(--direction-short-bg)',
        border: `1px solid ${side === 'long' ? 'var(--direction-long-border)' : 'var(--direction-short-border)'}`,
      }}
    >
      {side === 'long' ? '多' : '空'}
    </span>
  )
}
