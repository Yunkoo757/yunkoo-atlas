import type { TradeKind } from '@/data/trades'
import { DEFAULT_PROFILE_DISPLAY } from '@/config/defaultProfile'
import type { CalendarPeriod } from '@/lib/periods'
import { DEFAULT_SIDEBAR_PINS, type SidebarNavId } from '@/lib/sidebarNav'
import { normalizeSidebarPins } from '@/lib/tradeKind'
import { listPathFromLegacyTablePath } from '@/lib/routeContext'
import {
  migrateSidebarPins,
  normalizeSidebarWorkspaceItems,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'

export type ListFilterType =
  | 'all'
  | 'active'
  | 'starred'
  | 'strategy'
  | 'period'
  | 'missed'

export interface ListFilter {
  type: ListFilterType
  strategyId?: string
  period?: CalendarPeriod
  /** 默认不过滤；主列表传 live，模拟页传 paper */
  tradeKind?: TradeKind
  reviewCaseScope?: ReviewCaseScope
}

export type ReviewCaseScope = 'all' | 'focus' | 'mistakes' | 'unreviewed' | 'reviewed'

export { applyDisplayPrefs, filterTrades } from '@/lib/workbenchTrades'

export interface DisplayPrefs {
  hideClosed: boolean
  showEmptyGroups: boolean
  groupByStrategy: boolean
  groupByDate: boolean
  sortBy: 'date' | 'pnl' | 'conviction'
  /** 旧版侧栏快捷入口偏好，保留用于兼容历史快照 */
  sidebarPins: SidebarNavId[]
  sidebarWorkspaceItems: SidebarWorkspaceItem[]
  /** 侧栏「今日记录 / 交易日志 / 案例记录」上次进入的工作区路由 */
  workspaceMemory?: {
    today?: { pathname: string; search: string }
    trade?: { pathname: string; search: string }
    case?: { pathname: string; search: string }
  }
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  hideClosed: DEFAULT_PROFILE_DISPLAY.hideClosed,
  showEmptyGroups: DEFAULT_PROFILE_DISPLAY.showEmptyGroups,
  groupByStrategy: DEFAULT_PROFILE_DISPLAY.groupMode === 'strategy',
  groupByDate: DEFAULT_PROFILE_DISPLAY.groupMode === 'date',
  sortBy: DEFAULT_PROFILE_DISPLAY.sortBy,
  sidebarPins: [...DEFAULT_SIDEBAR_PINS],
  sidebarWorkspaceItems: migrateSidebarPins(DEFAULT_SIDEBAR_PINS),
}

const SORT_BY = ['date', 'pnl', 'conviction'] as const

function normalizeWorkspaceRoute(input: unknown): { pathname: string; search: string } | undefined {
  if (!input || typeof input !== 'object') return undefined
  const route = input as Record<string, unknown>
  if (typeof route.pathname !== 'string' || !route.pathname.startsWith('/')) return undefined
  return {
    pathname: listPathFromLegacyTablePath(route.pathname) ?? route.pathname,
    search: typeof route.search === 'string' ? route.search : '',
  }
}

function normalizeWorkspaceMemory(
  input: unknown,
): DisplayPrefs['workspaceMemory'] {
  if (!input || typeof input !== 'object') return undefined
  const memory = input as Record<string, unknown>
  const today = normalizeWorkspaceRoute(memory.today)
  const trade = normalizeWorkspaceRoute(memory.trade)
  const caseRoute = normalizeWorkspaceRoute(memory.case)
  if (!today && !trade && !caseRoute) return undefined
  return {
    ...(today ? { today } : {}),
    ...(trade ? { trade } : {}),
    ...(caseRoute ? { case: caseRoute } : {}),
  }
}

/** 合并旧版/残缺 display，避免缺字段导致渲染崩溃 */
export function normalizeDisplay(input?: Partial<DisplayPrefs> | null): DisplayPrefs {
  const d = input ?? {}
  const sidebarPins = Array.isArray(d.sidebarPins)
    ? normalizeSidebarPins(d.sidebarPins)
    : [...DEFAULT_DISPLAY.sidebarPins]
  const sidebarWorkspaceItems = Object.prototype.hasOwnProperty.call(d, 'sidebarWorkspaceItems')
    ? normalizeSidebarWorkspaceItems(d.sidebarWorkspaceItems)
    : migrateSidebarPins(sidebarPins)
  const workspaceMemory = normalizeWorkspaceMemory(d.workspaceMemory)
  return {
    hideClosed: typeof d.hideClosed === 'boolean' ? d.hideClosed : DEFAULT_DISPLAY.hideClosed,
    showEmptyGroups:
      typeof d.showEmptyGroups === 'boolean' ? d.showEmptyGroups : DEFAULT_DISPLAY.showEmptyGroups,
    groupByStrategy:
      typeof d.groupByStrategy === 'boolean' ? d.groupByStrategy : DEFAULT_DISPLAY.groupByStrategy,
    groupByDate: typeof d.groupByDate === 'boolean' ? d.groupByDate : DEFAULT_DISPLAY.groupByDate,
    sortBy: SORT_BY.includes(d.sortBy as (typeof SORT_BY)[number])
      ? (d.sortBy as DisplayPrefs['sortBy'])
      : DEFAULT_DISPLAY.sortBy,
    sidebarPins,
    sidebarWorkspaceItems,
    ...(workspaceMemory ? { workspaceMemory } : {}),
  }
}

/** 命令面板 / 搜索：查询词按空格分词，每词须在字段中命中 */
export function matchesSearchQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return tokens.every((t) => haystack.includes(t))
}
