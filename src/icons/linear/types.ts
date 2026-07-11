import type { SVGAttributes } from 'react'

export interface LinearStaticIconProps extends SVGAttributes<SVGSVGElement> {
  size?: number | string
  title?: string
}

export type LinearIssueState =
  | 'triage'
  | 'backlog'
  | 'todo'
  | 'started'
  | 'completed'
  | 'duplicate'
  | 'canceled'

export interface LinearProgressIconProps extends LinearStaticIconProps {
  progress?: number
}
