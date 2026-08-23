import { describeListFilterDateField, type ListFilter } from '@/lib/tradeFilters'
import { formatPeriodSubtitle, type BusinessDateAnchor } from '@/lib/periods'

export const MISSED_PAGE_TITLE = '错过的机会'

export function getTradesPageSubtitle(
  filter: ListFilter,
  businessDateAnchor?: BusinessDateAnchor,
): string | undefined {
  if (filter.historicalLiveScope === 'trades') return '历史阶段的实盘交易'
  if (filter.historicalLiveScope === 'cases') return '历史阶段的关联案例'
  if (filter.analysisScope) {
    return `仪表盘绩效下钻 · ${describeListFilterDateField(filter)}`
  }
  if (filter.type === 'active') return '进行中 · 计划中 + 持仓中'
  if (filter.type === 'starred') return '星标交易'
  if (filter.type === 'missed') return '未实际执行的机会 · 假设盈亏'
  if (filter.type === 'incomplete') return '需要补充结果或复盘内容'
  if (filter.type === 'period' && filter.period) {
    return formatPeriodSubtitle(filter.period, businessDateAnchor ?? new Date())
  }
  if (filter.type === 'all' && filter.tradeKind === 'live') return '实盘交易'
  if (filter.tradeKind === 'paper') return '模拟盘 · 不计入实盘 KPI'
  if (filter.tradeKind === 'case') return '独立复盘 · 不计入仪表盘统计'
  return undefined
}
