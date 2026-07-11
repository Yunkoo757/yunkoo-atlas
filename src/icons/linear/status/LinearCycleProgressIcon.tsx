import { resolveIconA11y } from '../iconA11y'
import type { LinearProgressIconProps } from '../types'
import './linearStatusIcons.css'

export interface LinearCycleProgressIconProps extends LinearProgressIconProps {
  active?: boolean
  planned?: boolean
  completed?: boolean
  next?: boolean
}

const RADIUS = 6.25
const STROKE_WIDTH = 1.5
const PERIMETER = 2 * Math.PI * RADIUS
const GAP = 3
const PLANNED_DASH_LENGTH = PERIMETER / 24

function clampProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function normalizeProgress(progress: number): number {
  return 0.065 + progress * (0.935 + GAP / PERIMETER)
}

export function LinearCycleProgressIcon({
  progress,
  active = false,
  planned = false,
  completed = false,
  next = false,
  size = 14,
  title,
  color,
  className,
  ...props
}: LinearCycleProgressIconProps) {
  const a11y = resolveIconA11y(title)
  const iconColor = color ?? 'currentColor'
  const clampedProgress = completed ? 1 : clampProgress(progress)
  const progressOffset = PERIMETER - normalizeProgress(clampedProgress) * PERIMETER
  const svgClassName = ['linear-cycle-progress', className].filter(Boolean).join(' ')

  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={svgClassName}
      xmlns="http://www.w3.org/2000/svg"
    >
      {a11y.titleNode}
      {next ? (
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke={iconColor}
          strokeWidth={STROKE_WIDTH}
          opacity="0.32"
          fill="none"
        />
      ) : null}
      {planned ? (
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke={iconColor}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={`${PLANNED_DASH_LENGTH} ${GAP}`}
          strokeLinecap="round"
          fill="none"
          transform="rotate(-90 7 7)"
        />
      ) : null}
      {active ? (
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke={iconColor}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={`${PERIMETER - GAP} ${PERIMETER}`}
          strokeDashoffset={progressOffset}
          strokeLinecap="round"
          fill="none"
          transform="rotate(-90 7 7)"
        />
      ) : null}
      {completed ? (
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke={iconColor}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
      ) : null}
    </svg>
  )
}
