import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleX,
  Copy,
} from 'lucide-react'

export type StatusIndicatorState =
  | 'triage'
  | 'backlog'
  | 'todo'
  | 'started'
  | 'completed'
  | 'duplicate'
  | 'canceled'

export interface StatusIndicatorProps extends LucideProps {
  state: StatusIndicatorState
  progress?: number
}

const STATUS_ICONS: Record<StatusIndicatorState, LucideIcon> = {
  triage: CircleHelp,
  backlog: CircleDashed,
  todo: Circle,
  started: CircleDot,
  completed: CircleCheck,
  duplicate: Copy,
  canceled: CircleX,
}

export function StatusIndicator({ state, progress: _progress, ...props }: StatusIndicatorProps) {
  const Icon = STATUS_ICONS[state]
  return <Icon {...props} />
}

export function DisclosureChevron(props: LucideProps) {
  return <ChevronRight {...props} />
}
