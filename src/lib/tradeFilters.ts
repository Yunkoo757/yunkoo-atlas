import type { Trade, TradeKind, Conviction } from '@/data/trades'
import type { CalendarPeriod } from '@/lib/periods'
import { tradeInPeriod } from '@/lib/periods'
import { isActive, isHiddenWhenClosedFilter, isMissed } from '@/lib/tradeStatus'

export type ListFilterType =
  | 'all'
  | 'inbox'
  | 'mine'
  | 'starred'
  | 'strategy'
  | 'period'
  | 'missed'

export interface ListFilter {
  type: ListFilterType
  strategyId?: string
  period?: CalendarPeriod
  /** 默认不过滤；主列表传 live，纸面/练习页传对应 kind */
  tradeKind?: TradeKind
}

export interface DisplayPrefs {
  hideClosed: boolean
  showEmptyGroups: boolean
  groupByStrategy: boolean
  groupByDate: boolean
  sortBy: 'date' | 'pnl' | 'conviction'
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  hideClosed: false,
  showEmptyGroups: false,
  groupByStrategy: false,
  groupByDate: false,
  sortBy: 'date',
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
    case 'inbox':
    case 'mine':
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
