import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Ban,
  BookOpen,
  CalendarDays,
  CircleDot,
  FlaskConical,
  ListTodo,
  Star,
} from 'lucide-react'

export type PrimarySidebarNavId = 'today' | 'trades' | 'reviewCases' | 'dashboard'

export interface PrimarySidebarNavItem {
  id: PrimarySidebarNavId
  to: string
  label: string
  icon: LucideIcon
}

export const PRIMARY_NAV: PrimarySidebarNavItem[] = [
  { id: 'today', to: '/today-record', label: '今日记录', icon: CalendarDays },
  { id: 'trades', to: '/list', label: '交易日志', icon: ListTodo },
  { id: 'reviewCases', to: '/review-cases', label: '案例记录', icon: BookOpen },
  { id: 'dashboard', to: '/dashboard', label: '仪表盘', icon: BarChart3 },
]

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
