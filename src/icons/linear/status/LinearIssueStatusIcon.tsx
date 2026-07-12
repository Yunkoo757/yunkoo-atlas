import { resolveIconA11y } from '../iconA11y'
import type { LinearIssueState, LinearProgressIconProps } from '../types'
import './linearStatusIcons.css'

export interface LinearIssueStatusIconProps extends LinearProgressIconProps {
  state: LinearIssueState
  /** 完成/取消等终态字形弹出；进度态路径平滑过渡 */
  animate?: boolean
}

const TRIAGE_PATH =
  'M7 14C10.866 14 14 10.866 14 7C14 3.13403 10.866 0 7 0C3.134 0 0 3.13403 0 7C0 10.866 3.134 14 7 14ZM8.0126 9.50781V7.98224H5.9874V9.50787C5.9874 9.92908 5.4767 10.1549 5.14897 9.8786L2.17419 7.37073C1.94194 7.17493 1.94194 6.82513 2.17419 6.62933L5.14897 4.12146C5.4767 3.84515 5.9874 4.07098 5.9874 4.49219V6.01764H8.0126V4.49213C8.0126 4.07092 8.5233 3.84509 8.85103 4.1214L11.8258 6.62927C12.0581 6.82507 12.0581 7.17487 11.8258 7.37067L8.85103 9.87854C8.5233 10.1548 8.0126 9.92902 8.0126 9.50781Z'
const BACKLOG_PATH =
  'M13.9408 7.91426L11.9576 7.65557C11.9855 7.4419 12 7.22314 12 7C12 6.77686 11.9855 6.5581 11.9576 6.34443L13.9408 6.08573C13.9799 6.38496 14 6.69013 14 7C14 7.30987 13.9799 7.61504 13.9408 7.91426ZM13.4688 4.32049C13.2328 3.7514 12.9239 3.22019 12.5538 2.73851L10.968 3.95716C11.2328 4.30185 11.4533 4.68119 11.6214 5.08659L13.4688 4.32049ZM11.2615 1.4462L10.0428 3.03204C9.69815 2.76716 9.31881 2.54673 8.91341 2.37862L9.67951 0.531163C10.2486 0.767153 10.7798 1.07605 11.2615 1.4462ZM7.91426 0.0591659L7.65557 2.04237C7.4419 2.01449 7.22314 2 7 2C6.77686 2 6.5581 2.01449 6.34443 2.04237L6.08574 0.059166C6.38496 0.0201343 6.69013 0 7 0C7.30987 0 7.61504 0.0201343 7.91426 0.0591659ZM4.32049 0.531164L5.08659 2.37862C4.68119 2.54673 4.30185 2.76716 3.95716 3.03204L2.73851 1.4462C3.22019 1.07605 3.7514 0.767153 4.32049 0.531164ZM1.4462 2.73851L3.03204 3.95716C2.76716 4.30185 2.54673 4.68119 2.37862 5.08659L0.531164 4.32049C0.767153 3.7514 1.07605 3.22019 1.4462 2.73851ZM0.0591659 6.08574C0.0201343 6.38496 0 6.69013 0 7C0 7.30987 0.0201343 7.61504 0.059166 7.91426L2.04237 7.65557C2.01449 7.4419 2 7.22314 2 7C2 6.77686 2.01449 6.5581 2.04237 6.34443L0.0591659 6.08574ZM0.531164 9.67951L2.37862 8.91341C2.54673 9.31881 2.76716 9.69815 3.03204 10.0428L1.4462 11.2615C1.07605 10.7798 0.767153 10.2486 0.531164 9.67951ZM2.73851 12.5538L3.95716 10.968C4.30185 11.2328 4.68119 11.4533 5.08659 11.6214L4.32049 13.4688C3.7514 13.2328 3.22019 12.9239 2.73851 12.5538ZM6.08574 13.9408L6.34443 11.9576C6.5581 11.9855 6.77686 12 7 12C7.22314 12 7.4419 11.9855 7.65557 11.9576L7.91427 13.9408C7.61504 13.9799 7.30987 14 7 14C6.69013 14 6.38496 13.9799 6.08574 13.9408ZM9.67951 13.4688L8.91341 11.6214C9.31881 11.4533 9.69815 11.2328 10.0428 10.968L11.2615 12.5538C10.7798 12.9239 10.2486 13.2328 9.67951 13.4688ZM12.5538 11.2615L10.968 10.0428C11.2328 9.69815 11.4533 9.31881 11.6214 8.91341L13.4688 9.67951C13.2328 10.2486 12.924 10.7798 12.5538 11.2615Z'
const COMPLETED_PATH =
  'M7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0ZM11.101 5.10104C11.433 4.76909 11.433 4.23091 11.101 3.89896C10.7691 3.56701 10.2309 3.56701 9.89896 3.89896L5.5 8.29792L4.10104 6.89896C3.7691 6.56701 3.2309 6.56701 2.89896 6.89896C2.56701 7.2309 2.56701 7.7691 2.89896 8.10104L4.89896 10.101C5.2309 10.433 5.7691 10.433 6.10104 10.101L11.101 5.10104Z'
const DUPLICATE_PATH =
  'M7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14ZM9.5791 5.71973C9.872 5.42684 10.3468 5.42686 10.6396 5.71973C10.9325 6.01262 10.9325 6.48738 10.6396 6.78027L6.78027 10.6396C6.48738 10.9325 6.01262 10.9325 5.71973 10.6396C5.42686 10.3468 5.42684 9.872 5.71973 9.5791L9.5791 5.71973ZM7.21973 3.36035C7.51261 3.06746 7.98738 3.06747 8.28027 3.36035C8.57315 3.65325 8.57316 4.12801 8.28027 4.4209L4.4209 8.28027C4.12801 8.57316 3.65325 8.57315 3.36035 8.28027C3.06747 7.98738 3.06746 7.51261 3.36035 7.21973L7.21973 3.36035Z'
const CANCELED_PATH =
  'M7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14ZM5.03033 3.96967C4.73744 3.67678 4.26256 3.67678 3.96967 3.96967C3.67678 4.26256 3.67678 4.73744 3.96967 5.03033L5.93934 7L3.96967 8.96967C3.67678 9.26256 3.67678 9.73744 3.96967 10.0303C4.26256 10.3232 4.73744 10.3232 5.03033 10.0303L7 8.06066L8.96967 10.0303C9.26256 10.3232 9.73744 10.3232 10.0303 10.0303C10.3232 9.73744 10.3232 9.26256 10.0303 8.96967L8.06066 7L10.0303 5.03033C10.3232 4.73744 10.3232 4.26256 10.0303 3.96967C9.73744 3.67678 9.26256 3.67678 8.96967 3.96967L7 5.93934L5.03033 3.96967Z'

function clampProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function ProgressSector({ progress, color }: { progress: number; color: string }) {
  const radius = 3.5
  const degrees = 360 * progress
  const shortDegrees = degrees > 180 ? 360 - degrees : degrees
  const radians = (shortDegrees * Math.PI) / 180
  const chord = Math.sqrt(2 * radius ** 2 - 2 * radius ** 2 * Math.cos(radians))
  const vertical =
    shortDegrees <= 90
      ? radius * Math.sin(radians)
      : radius * Math.sin(((180 - shortDegrees) * Math.PI) / 180)
  const horizontal = Math.sqrt(chord ** 2 - vertical ** 2)
  const endX = degrees <= 180 ? radius + vertical : radius - vertical
  const largeArc = degrees <= 180 ? 0 : 1
  return (
    <>
      <rect x="1" y="1" width="12" height="12" rx="6" stroke={color} strokeWidth="1.5" fill="none" />
      <path
        fill={color}
        stroke="none"
        d={`M ${radius},${radius} L${radius},0 A${radius},${radius} 0 ${largeArc},1 ${endX}, ${horizontal} z`}
        transform={`translate(${radius},${radius})`}
      />
    </>
  )
}

function ArchivedStatusPath({ state, color }: { state: LinearIssueState; color: string }) {
  switch (state) {
    case 'triage':
      return <path fill={color} stroke="none" d={TRIAGE_PATH} />
    case 'backlog':
      return <path fill={color} stroke="none" d={BACKLOG_PATH} />
    case 'completed':
      return <path fill={color} fillRule="evenodd" clipRule="evenodd" d={COMPLETED_PATH} />
    case 'duplicate':
      return <path fill={color} fillRule="evenodd" clipRule="evenodd" stroke="none" d={DUPLICATE_PATH} />
    case 'canceled':
      return <path fill={color} fillRule="evenodd" clipRule="evenodd" stroke="none" d={CANCELED_PATH} />
    default:
      return null
  }
}

export function LinearIssueStatusIcon({
  state,
  progress,
  animate = false,
  size = 14,
  title,
  color,
  className,
  ...props
}: LinearIssueStatusIconProps) {
  const a11y = resolveIconA11y(title)
  const iconColor = color ?? 'currentColor'
  const isProgress = state === 'todo' || state === 'started'
  const content = isProgress ? (
    <ProgressSector progress={clampProgress(state === 'todo' ? 0 : progress)} color={iconColor} />
  ) : (
    <g className={animate ? 'linear-issue-status__completion' : undefined}>
      <ArchivedStatusPath state={state} color={iconColor} />
    </g>
  )

  const svgClassName = [
    animate ? 'linear-issue-status--transition' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ') || undefined

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
      {content}
    </svg>
  )
}
