import { useId } from 'react'
import { resolveIconA11y } from '../iconA11y'
import type { LinearProgressIconProps } from '../types'
import './linearStatusIcons.css'

export type LinearProjectStatusState = 'backlog' | 'planned' | 'started' | 'completed' | 'canceled'

export interface LinearProjectStatusIconProps extends LinearProgressIconProps {
  state: LinearProjectStatusState
  animate?: boolean
}

const PROJECT_CIRCUMFERENCE = 25.12
const HEXAGON_PATH =
  'M2.95778 3.02069L5.70777 1.36023C6.50244 0.88041 7.49756 0.88041 8.29223 1.36024L11.0422 3.02074C11.7918 3.47336 12.25 4.2852 12.25 5.16086V8.84803C12.25 9.7251 11.7904 10.5381 11.0388 10.9902L8.29114 12.6433C7.49693 13.1211 6.50355 13.1203 5.71011 12.6412L2.95775 10.9792C2.20815 10.5266 1.75 9.7148 1.75 8.83911V5.16082C1.75 4.28516 2.20816 3.47332 2.95778 3.02069Z'
const HOLE_MASK_PATH =
  'M8.3779 4.74233C8.14438 4.60607 7.85562 4.60607 7.6221 4.74233L5.37209 6.05513C5.14168 6.18957 5 6.4363 5 6.70311V9.34216C5 9.60897 5.14168 9.85573 5.37209 9.99016L7.6221 11.303C7.85562 11.4392 8.14438 11.4392 8.3779 11.303L10.6279 9.99016C10.8583 9.85573 11 9.60897 11 9.34216V6.70311C11 6.4363 10.8583 6.18957 10.6279 6.05513L8.3779 4.74233Z'
const COMPLETED_PATH =
  'M10.7803 5.28033C11.0732 4.98744 11.0732 4.51256 10.7803 4.21967C10.4874 3.92678 10.0126 3.92678 9.7197 4.21967L5.75 8.18934L4.28033 6.71967C3.98744 6.42678 3.51256 6.42678 3.21967 6.71967C2.92678 7.01256 2.92678 7.48744 3.21967 7.78033L5.21967 9.7803C5.51256 10.0732 5.98744 10.0732 6.28033 9.7803L10.7803 5.28033Z'
const CANCELED_PATH =
  'M3.73657 3.73657C4.05199 3.42114 4.56339 3.42114 4.87881 3.73657L5.93941 4.79716L7 5.85775L9.12117 3.73657C9.4366 3.42114 9.94801 3.42114 10.2634 3.73657C10.5789 4.05199 10.5789 4.56339 10.2634 4.87881L8.14225 7L10.2634 9.12118C10.5789 9.4366 10.5789 9.94801 10.2634 10.2634C9.94801 10.5789 9.4366 10.5789 9.12117 10.2634L7 8.14225L4.87881 10.2634C4.56339 10.5789 4.05199 10.5789 3.73657 10.2634C3.42114 9.94801 3.42114 9.4366 3.73657 9.12118L4.79716 8.06059L5.85775 7L3.73657 4.87881C3.42114 4.56339 3.42114 4.05199 3.73657 3.73657Z'

function clampProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function formatProgressDash(progress: number): string {
  return Number((progress * PROJECT_CIRCUMFERENCE).toFixed(4)).toString()
}

export function LinearProjectStatusIcon({
  state,
  progress,
  animate = false,
  size = 16,
  title,
  color,
  className,
  ...props
}: LinearProjectStatusIconProps) {
  const a11y = resolveIconA11y(title)
  const id = useId()
  const maskId = `${id}-project-hole`
  const iconColor = color ?? 'currentColor'
  const normalizedProgress = state === 'completed' || state === 'canceled' ? 1 : clampProgress(progress)
  const completionPath = state === 'completed' ? COMPLETED_PATH : state === 'canceled' ? CANCELED_PATH : undefined
  const svgClassName = [
    animate ? 'linear-project-status--transition' : undefined,
    className,
  ].filter(Boolean).join(' ') || undefined

  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox="-1 -1 16 16"
      fill="none"
      stroke="none"
      className={svgClassName}
      xmlns="http://www.w3.org/2000/svg"
    >
      {a11y.titleNode}
      <path
        d={HEXAGON_PATH}
        stroke={iconColor}
        strokeWidth="1.5"
        strokeLinejoin="bevel"
        strokeDasharray={state === 'backlog' ? '1.65 1.35' : '3.14 0'}
        strokeDashoffset={state === 'backlog' ? 2.3 : 1}
        fill="none"
      />
      <g mask={`url(#${maskId})`}>
        <circle
          r="4"
          cx="7"
          cy="7"
          stroke={iconColor}
          fill="none"
          strokeWidth="8"
          strokeDasharray={`calc(${formatProgressDash(normalizedProgress)}) ${PROJECT_CIRCUMFERENCE}`}
          transform="rotate(-90) translate(-14, 0)"
        />
      </g>
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <path
          transform={normalizedProgress === 1 ? 'translate(-7.5, -7.5) scale(1.8)' : 'translate(-1, -1)'}
          d={HOLE_MASK_PATH}
          fill="white"
        />
        {completionPath ? (
          <path
            className={animate ? 'linear-project-status__completion' : undefined}
            stroke="none"
            fill="black"
            d={completionPath}
          />
        ) : null}
      </mask>
    </svg>
  )
}
