export type DashboardEmptyState = Readonly<{
  kind: 'library' | 'scope' | 'ineligible'
  title: string
  hint: string
  primary: 'create' | 'view-active' | 'all-data' | 'all-dates' | 'view-records'
  primaryLabel: string
}>

/** 只消费 Dashboard 已经计算好的数量，不重新解释交易领域规则。 */
export function resolveDashboardEmptyState(input: {
  totalRecordCount: number
  scopedRecordCount: number
  eligibleClosedCount: number
  activeRecordCount: number
  dateRangeLimited?: boolean
}): DashboardEmptyState | null {
  if (input.eligibleClosedCount > 0) return null
  if (input.totalRecordCount === 0) {
    return {
      kind: 'library',
      title: '还没有交易记录',
      hint: '新建并完成第一笔交易后，这里会生成盈亏曲线与策略表现。',
      primary: 'create',
      primaryLabel: '新建交易',
    }
  }
  if (input.scopedRecordCount === 0) {
    return {
      kind: 'scope',
      title: '当前分析范围暂无交易',
      hint: '其他阶段或记录类型中有交易。',
      primary: 'all-data',
      primaryLabel: '查看全部数据',
    }
  }
  return {
    kind: 'ineligible',
    title: '当前范围暂无可统计结果',
    hint: input.activeRecordCount > 0
      ? '当前仍有进行中或待完善交易；平仓并补全结果后会进入统计。'
      : '当前范围内没有可计入统计的已平仓结果。',
    primary: input.activeRecordCount > 0 ? 'view-active' : input.dateRangeLimited ? 'all-dates' : 'view-records',
    primaryLabel: input.activeRecordCount > 0 ? '查看进行中交易' : input.dateRangeLimited ? '查看全部周期' : '查看范围内交易',
  }
}
