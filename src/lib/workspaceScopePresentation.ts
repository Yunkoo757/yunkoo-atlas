import { describeListFilterDateField, type ListFilter } from '@/lib/tradeFilters'
import { formatPeriodSubtitle, type BusinessDateAnchor } from '@/lib/periods'

export type WorkspaceScopePresentation = {
  summary?: string
  clearIntent: 'none' | 'advanced-only' | 'scope-and-advanced'
}

/**
 * 纯展示模型：只解释已经规范化的列表范围，不解析、修改或重新编码 URL。
 */
export function presentWorkspaceScope(
  filter: ListFilter,
  options: {
    businessDateAnchor?: BusinessDateAnchor
    hasAdvancedFilters?: boolean
  } = {},
): WorkspaceScopePresentation {
  let summary: string | undefined
  if (filter.historicalLiveScope === 'trades') summary = '历史阶段的实盘交易'
  else if (filter.historicalLiveScope === 'cases') summary = '历史阶段的关联案例'
  else if (filter.analysisScope) summary = `统计分析绩效下钻 · ${describeListFilterDateField(filter)}`
  else if (filter.type === 'active') summary = '进行中'
  else if (filter.type === 'starred') summary = '星标交易'
  else if (filter.type === 'missed') summary = '未执行机会'
  else if (filter.type === 'incomplete') summary = '待完善'
  else if (filter.type === 'period' && filter.period) {
    summary = formatPeriodSubtitle(filter.period, options.businessDateAnchor ?? new Date())
  } else if (filter.tradeKind === 'paper') summary = '模拟盘'

  return {
    summary,
    clearIntent: options.hasAdvancedFilters
      ? 'advanced-only'
      : summary
        ? 'scope-and-advanced'
        : 'none',
  }
}
