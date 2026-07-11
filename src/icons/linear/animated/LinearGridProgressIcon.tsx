import { useId } from 'react'
import { resolveIconA11y } from '../iconA11y'
import type { LinearProgressIconProps } from '../types'

const GRID_DOTS = Array.from({ length: 25 }, (_, index) => ({
  cx: 1 + (index % 5) * 3.5,
  cy: 1 + Math.floor(index / 5) * 3.5,
}))

function clampProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function sanitizeAnimationName(id: string): string {
  return `linear-grid-progress-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

export function LinearGridProgressIcon({
  progress,
  size = 16,
  title,
  color,
  ...props
}: LinearProgressIconProps) {
  const id = useId()
  const a11y = resolveIconA11y(title)
  const iconColor = color ?? 'currentColor'
  const filledCount = Math.floor(clampProgress(progress) * 25)
  const shouldPulse = filledCount > 0 && filledCount < 25
  const animationName = sanitizeAnimationName(id)

  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {a11y.titleNode}
      {shouldPulse ? (
        <style>{`@keyframes ${animationName} { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
      ) : null}
      {GRID_DOTS.map((dot, index) => {
        const isFilled = index < filledCount
        const isFrontier = shouldPulse && index === filledCount - 1
        return (
          <circle
            key={index}
            cx={dot.cx}
            cy={dot.cy}
            r="1"
            fill={iconColor}
            opacity={isFilled ? 1 : 0.3}
            style={isFrontier ? { animation: `${animationName} 600ms linear infinite` } : undefined}
          />
        )
      })}
    </svg>
  )
}
