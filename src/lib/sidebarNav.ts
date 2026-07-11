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
  { id: 'paper', to: '/sim', label: '模拟回测', icon: FlaskConical },
]

/** 默认固定在侧栏的快捷入口 */
export const DEFAULT_SIDEBAR_PINS: SidebarNavId[] = [
  'active',
  'favorites',
  'missed',
  'paper',
]

/** 按 sidebarPins 顺序解析快捷导航；空数组 → 空列表（侧栏不渲染「快捷」区） */
export function resolvePinnedSecondaryNav(
  pins: readonly SidebarNavId[],
): SidebarNavItem[] {
  const byId = new Map(SECONDARY_NAV.map((item) => [item.id, item]))
  const out: SidebarNavItem[] = []
  for (const id of pins) {
    const item = byId.get(id)
    if (item) out.push(item)
  }
  return out
}

export function isSidebarNavActive(path: string, to: string): boolean {
  return path === to || path.startsWith(`${to}/`)
}
