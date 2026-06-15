import type { ListFilter } from '@/lib/tradeFilters'
import { formatPeriodSubtitle } from '@/lib/periods'

export const MISSED_PAGE_TITLE = '错过的机会'

export function getTradesPageSubtitle(filter: ListFilter): string | undefined {
  if (filter.type === 'inbox') return '实盘 · 计划中 + 持仓中'
  if (filter.type === 'missed') return '未实际执行的机会 · 假设盈亏'
  if (filter.type === 'period' && filter.period) return formatPeriodSubtitle(filter.period)
  if (filter.type === 'all' && filter.tradeKind === 'live') return '实盘交易'
  if (filter.tradeKind === 'paper') return '纸面模拟 · 不计入实盘 KPI'
  if (filter.tradeKind === 'practice') return '模拟练习 · 不计入实盘 KPI'
  return undefined
}
