import type { AppIcon } from '@/icons/appIcons'
import {
  Ban,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  CalendarDays,
  FileText,
  FlaskConical,
  ListTodo,
  RotateCcw,
  Star,
} from '@/icons/appIcons'
import {
  DEFAULT_PRIMARY_SIDEBAR_ORDER,
  DEFAULT_SIDEBAR_PINS,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  normalizePrimarySidebarOrder,
  type PrimarySidebarNavId,
  type SidebarNavId,
} from '@/lib/sidebarNavContract'

export {
  DEFAULT_PRIMARY_SIDEBAR_ORDER,
  DEFAULT_SIDEBAR_PINS,
  normalizePrimarySidebarOrder,
} from '@/lib/sidebarNavContract'
export type { PrimarySidebarNavId, SidebarNavId } from '@/lib/sidebarNavContract'

export type SidebarNavIcon = AppIcon

export interface PrimarySidebarNavItem {
  id: PrimarySidebarNavId
  to: string
  label: string
  icon: SidebarNavIcon
}

const PRIMARY_NAV_ICONS: Record<PrimarySidebarNavId, SidebarNavIcon> = {
  today: Calendar,
  quickNotes: FileText,
  trades: ListTodo,
  reviewCases: BookOpen,
  weeklyReview: CalendarDays,
  reviewSession: RotateCcw,
  dashboard: BarChart3,
}

export const PRIMARY_NAV: PrimarySidebarNavItem[] = PRIMARY_NAV_ITEMS.map((item) => ({
  ...item,
  icon: PRIMARY_NAV_ICONS[item.id],
}))

export function reorderPrimarySidebarNav(
  order: unknown,
  sourceId: PrimarySidebarNavId,
  targetId: PrimarySidebarNavId,
): PrimarySidebarNavId[] {
  const next = normalizePrimarySidebarOrder(order)
  const sourceIndex = next.indexOf(sourceId)
  const targetIndex = next.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next
  next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, sourceId)
  return next
}

export function resolvePrimarySidebarNav(order: unknown): PrimarySidebarNavItem[] {
  const byId = new Map(PRIMARY_NAV.map((item) => [item.id, item]))
  return normalizePrimarySidebarOrder(order)
    .map((id) => byId.get(id))
    .filter((item): item is PrimarySidebarNavItem => Boolean(item))
}

export interface SidebarNavItem {
  id: SidebarNavId
  to: string
  label: string
  icon: SidebarNavIcon
}

const SECONDARY_NAV_ICONS: Record<SidebarNavId, SidebarNavIcon> = {
  active: Clock,
  favorites: Star,
  missed: Ban,
  paper: FlaskConical,
}

export const SECONDARY_NAV: SidebarNavItem[] = SECONDARY_NAV_ITEMS.map((item) => ({
  ...item,
  icon: SECONDARY_NAV_ICONS[item.id],
}))

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
