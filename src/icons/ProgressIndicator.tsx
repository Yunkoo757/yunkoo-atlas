import type { SVGProps } from 'react'

export interface ProgressIndicatorProps extends Omit<SVGProps<SVGSVGElement>, 'title'> {
  progress?: number
  size?: number | string
  title?: string
}

function clampProgress(progress: number | undefined): number {
  if (progress === undefined || !Number.isFinite(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

export function ProgressIndicator({
  progress,
  size = 16,
  title,
  ...props
}: ProgressIndicatorProps) {
  const normalized = clampProgress(progress)
  const radius = 6
  const circumference = 2 * Math.PI * radius
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="8" cy="8" r={radius} stroke="currentColor" opacity="0.22" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - normalized)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}
