import type { LucideIcon } from 'lucide-react'
import { CircleDot, Star, Ban, FlaskConical } from 'lucide-react'

export type SidebarNavId = 'active' | 'favorites' | 'missed' | 'paper'

export interface SidebarNavItem {
  id: SidebarNavId
  to: string
  label: string
  icon: LucideIcon
}

export const SECONDARY_NAV: SidebarNavItem[] = [
  { id: 'active', to: '/active', label: '进行中', icon: CircleDot },
  { id: 'favorites', to: '/favorites', label: '星标交易', icon: Star },
  { id: 'missed', to: '/missed', label: '错过的机会', icon: Ban },
  { id: 'paper', to: '/sim', label: '模拟', icon: FlaskConical },
]

/** 默认固定在侧栏的快捷入口 */
export const DEFAULT_SIDEBAR_PINS: SidebarNavId[] = [
  'active',
  'favorites',
  'missed',
  'paper',
]

export function isSidebarNavActive(path: string, to: string): boolean {
  return path === to || path.startsWith(`${to}/`)
}
