import { useLayoutEffect, useRef, useState } from 'react'
import type { TradeStatus, Conviction } from '@/data/trades'
import { LinearIssueStatusIcon } from '@/icons/linear'
import type { LinearIssueState } from '@/icons/linear'
import { ICON_SM } from '@/icons/iconSize'
import './StatusIcon.css'

const STATUS_COLOR: Record<TradeStatus, string> = {
  planned: 'var(--text-tertiary)',
  open: 'var(--status-open)',
  missed: 'var(--status-missed)',
  win: 'var(--pos)',
  breakeven: 'var(--text-secondary)',
  loss: 'var(--neg)',
}

const STATUS_TO_LINEAR: Record<
  Exclude<TradeStatus, 'missed'>,
  { state: LinearIssueState; progress?: number }
> = {
  planned: { state: 'backlog' },
  open: { state: 'started', progress: 0.55 },
  win: { state: 'completed' },
  breakeven: { state: 'duplicate' },
  loss: { state: 'canceled' },
}

/** 错过：单斜线实心圆（≠ 亏损的 X，≠ 保本的双斜线） */
const MISSED_STATUS_PATH =
  'M7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14ZM10.0303 4.96967C10.3232 5.26256 10.3232 5.73744 10.0303 6.03033L6.03033 10.0303C5.73744 10.3232 5.26256 10.3232 4.96967 10.0303C4.67678 9.73744 4.67678 9.26256 4.96967 8.96967L8.96967 4.96967C9.26256 4.67678 9.73744 4.67678 10.0303 4.96967Z'

function MissedStatusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d={MISSED_STATUS_PATH}
      />
    </svg>
  )
}

export function StatusIcon({
  status,
  size = ICON_SM,
  animate = true,
}: {
  status: TradeStatus
  size?: number
  /** 状态切换时播放 Linear 式 pop；列表首次挂载不播，避免刷屏 */
  animate?: boolean
}) {
  const seen = useRef(false)
  const [motionTick, setMotionTick] = useState(0)

  useLayoutEffect(() => {
    if (!animate) return
    if (!seen.current) {
      seen.current = true
      return
    }
    setMotionTick((tick) => tick + 1)
  }, [status, animate])

  const mapped = status === 'missed' ? null : STATUS_TO_LINEAR[status]
  const glyph =
    status === 'missed' || !mapped ? (
      <MissedStatusIcon size={size} color={STATUS_COLOR.missed} />
    ) : (
      <LinearIssueStatusIcon
        state={mapped.state}
        progress={mapped.progress}
        size={size}
        color={STATUS_COLOR[status]}
        animate={false}
      />
    )

  if (!animate) return glyph

  return (
    <span
      key={`${status}-${motionTick}`}
      className={
        motionTick > 0 ? 'status-icon status-icon--animate' : 'status-icon'
      }
    >
      {glyph}
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
