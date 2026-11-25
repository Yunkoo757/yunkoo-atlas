import type { TradeStatus, Conviction } from '@/data/trades'
import { ICON_SM } from '@/icons/iconSize'
import './StatusIcon.css'

const STATUS_COLOR: Record<TradeStatus, string> = {
  planned: 'var(--text-tertiary)',
  open: 'var(--status-open)',
  missed: 'var(--status-missed)',
  win: 'var(--status-win)',
  breakeven: 'var(--text-secondary)',
  loss: 'var(--status-loss)',
}

const MISSED_STATUS_PATH =
  'M7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14ZM10.0303 4.96967C10.3232 5.26256 10.3232 5.73744 10.0303 6.03033L6.03033 10.0303C5.73744 10.3232 5.26256 10.3232 4.96967 10.0303C4.67678 9.73744 4.67678 9.26256 4.96967 8.96967L8.96967 4.96967C9.26256 4.67678 9.73744 4.67678 10.0303 4.96967Z'

export function StatusIcon({ status, size = ICON_SM, animate = true }: {
  status: TradeStatus
  size?: number
  animate?: boolean
}) {
  return (
    <span className="status-icon">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" data-icon-motion="status" data-status={status} data-animate={animate}
        style={{ color: STATUS_COLOR[status] }}>
        <circle className="status-ring" cx="12" cy="12" r="10" pathLength="100" />
        <circle className="status-dot" cx="12" cy="12" r="1" />
        <path className="status-result" d="M9 12 L11 14 L15 10" />
        <path className="status-cross" d="m9 9 6 6" pathLength="1" />
        <g className="status-even">
          <rect x="8" y="8" width="14" height="14" rx="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </g>
        <path className="status-missed" d={MISSED_STATUS_PATH} transform="scale(1.7142857)"
          fill="currentColor" stroke="none" fillRule="evenodd" />
      </svg>
    </span>
  )
}

// 信心度图标：三段信号条；极高与高同为满格，用紧急色区分（不再用红叹号方块）。
const BARS: Record<Conviction, number> = { low: 1, medium: 2, high: 3, urgent: 3 }

export function ConvictionIcon({
  conviction,
  size = ICON_SM,
}: {
  conviction: Conviction
  size?: number
}) {
  const active = BARS[conviction]
  const heights = [4, 7, 10]
  const on =
    conviction === 'urgent' ? 'var(--status-urgent)' : 'var(--text-secondary)'
  const off = 'var(--text-quaternary)'
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
          fill={i < active ? on : off}
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
