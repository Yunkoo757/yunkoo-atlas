import { createLucideIcon, type LucideProps } from 'lucide-react'
import { Bookmark, ChevronDown, ChevronRight, ChevronUp, Star } from './appIcons'
import './StateIcons.css'

type DisclosureKind = 'section' | 'menu' | 'upward-menu'
const chevrons = { section: ChevronRight, menu: ChevronDown, 'upward-menu': ChevronUp }

/** Native details and menu triggers can supply the expanded state directly in CSS. */
export function DisclosureIcon({ kind = 'section', expanded, ...props }: LucideProps & { kind?: DisclosureKind; expanded?: boolean }) {
  const Chevron = chevrons[kind]
  return <Chevron aria-hidden="true" {...props} data-icon-motion={kind} data-active={expanded} />
}

const PanelFrame = createLucideIcon('AtlasPanel', [
  ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3.25', strokeWidth: 'var(--icon-stroke-width)', key: 'frame' }],
])

export function PanelToggleIcon({ side, expanded, ...props }: LucideProps & { side: 'left' | 'right'; expanded: boolean }) {
  return (
    <PanelFrame aria-hidden="true" {...props} data-icon-motion="panel" data-side={side} data-active={expanded}>
      <rect className="atlas-panel-inset" x={side === 'left' ? 6 : 13} y="7.75" width="5" height="8.5" rx="1.25" fill="currentColor" stroke="none" />
    </PanelFrame>
  )
}

export function MarkIcon({ kind, active, ...props }: LucideProps & { kind: 'star' | 'bookmark'; active: boolean }) {
  const Mark = kind === 'star' ? Star : Bookmark
  return <Mark fill="currentColor" aria-hidden="true" {...props} data-icon-motion="mark" data-active={active} />
}

// Same Lucide check, traversed from the short stroke to the long stroke.
const CheckStroke = createLucideIcon('Check', [['path', { d: 'm4 12 5 5 11-11', pathLength: '1', key: 'check' }]])

export function CheckMark({ checked, ...props }: LucideProps & { checked: boolean }) {
  return <CheckStroke aria-hidden="true" {...props} data-icon-motion="check" data-active={checked} />
}

// The unbroken pin and PinOff share these outline segments. Only the two gaps and slash change.
const PinStrokes = createLucideIcon('Pin', [
  ['path', { d: 'M12 17v5 M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89 M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11', key: 'outline' }],
  ['path', { d: 'M7.89 2A2 2 0 0 0 8 6a1 1 0 0 1 1 1v2', className: 'pin-bridge', pathLength: '1', key: 'top' }],
  ['path', { d: 'M17 17h1a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9.34', className: 'pin-bridge', pathLength: '1', key: 'bottom' }],
  ['path', { d: 'm2 2 20 20', className: 'pin-slash', pathLength: '1', key: 'slash' }],
])

export function PinActionIcon({ pinned, ...props }: LucideProps & { pinned: boolean }) {
  return <PinStrokes aria-hidden="true" {...props} data-icon-motion="pin" data-active={pinned} />
}
