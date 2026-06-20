import type { Trade, TradeKind, Conviction } from '@/data/trades'
import type { CalendarPeriod } from '@/lib/periods'
import { tradeInPeriod } from '@/lib/periods'
import { isActive, isHiddenWhenClosedFilter, isMissed } from '@/lib/tradeStatus'
import { DEFAULT_SIDEBAR_PINS, type SidebarNavId } from '@/lib/sidebarNav'
import { normalizeSidebarPins } from '@/lib/tradeKind'

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
}

export interface DisplayPrefs {
  hideClosed: boolean
  showEmptyGroups: boolean
  groupByStrategy: boolean
  groupByDate: boolean
  sortBy: 'date' | 'pnl' | 'conviction'
  /** 旧版侧栏快捷入口偏好，保留用于兼容历史快照 */
  sidebarPins: SidebarNavId[]
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  hideClosed: false,
  showEmptyGroups: false,
  groupByStrategy: false,
  groupByDate: false,
  sortBy: 'date',
  sidebarPins: [...DEFAULT_SIDEBAR_PINS],
}

const SORT_BY = ['date', 'pnl', 'conviction'] as const

/** 合并旧版/残缺 display，避免缺字段导致渲染崩溃 */
export function normalizeDisplay(input?: Partial<DisplayPrefs> | null): DisplayPrefs {
  const d = input ?? {}
  const sidebarPins = Array.isArray(d.sidebarPins)
    ? normalizeSidebarPins(d.sidebarPins)
    : [...DEFAULT_DISPLAY.sidebarPins]
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
  }
}

/** 命令面板 / 搜索：查询词按空格分词，每词须在字段中命中 */
export function matchesSearchQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return tokens.every((t) => haystack.includes(t))
}

const CONVICTION_RANK: Record<Conviction, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function filterTrades(
  trades: Trade[],
  filter: ListFilter,
  starredIds: string[],
): Trade[] {
  let out = trades
  switch (filter.type) {
    case 'active':
      out = trades.filter((t) => isActive(t.status))
      break
    case 'starred':
      out = trades.filter((t) => starredIds.includes(t.id))
      break
    case 'strategy':
      if (filter.strategyId) {
        out = trades.filter((t) => t.strategyId === filter.strategyId)
      }
      break
    case 'missed':
      out = trades.filter((t) => isMissed(t.status))
      break
    case 'period':
      if (filter.period) {
        out = trades.filter((t) => tradeInPeriod(t, filter.period!))
      }
      break
    default:
      break
  }
  if (filter.tradeKind) {
    out = out.filter((t) => t.tradeKind === filter.tradeKind)
  }
  return out
}

export function applyDisplayPrefs(
  trades: Trade[],
  prefs: DisplayPrefs,
  filter?: ListFilter,
): Trade[] {
  let out = [...trades]
  const skipHideClosed = filter?.type === 'missed'
  if (prefs.hideClosed && !skipHideClosed) {
    out = out.filter((t) => !isHiddenWhenClosedFilter(t.status))
  }
  out.sort((a, b) => {
    if (prefs.sortBy === 'pnl') return b.pnl - a.pnl
    if (prefs.sortBy === 'conviction') {
      return CONVICTION_RANK[b.conviction] - CONVICTION_RANK[a.conviction]
    }
    return +new Date(b.openedAt) - +new Date(a.openedAt)
  })
  return out
}
