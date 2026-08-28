export type DashboardEmptyState = Readonly<{
  kind: 'library' | 'scope' | 'ineligible'
  title: string
  hint: string
  primary: 'create' | 'view-active' | 'adjust-scope'
  primaryLabel: string
  secondary?: 'create' | 'adjust-scope'
  secondaryLabel?: string
}>

/** 只消费 Dashboard 已经计算好的数量，不重新解释交易领域规则。 */
export function resolveDashboardEmptyState(input: {
  totalRecordCount: number
  scopedRecordCount: number
  eligibleClosedCount: number
  activeRecordCount: number
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
      hint: '其他阶段、类型或周期已有记录，可以调整当前分析范围。',
      primary: 'adjust-scope',
      primaryLabel: '调整分析范围',
      secondary: 'create',
      secondaryLabel: '新建交易',
    }
  }
  return {
    kind: 'ineligible',
    title: '当前范围暂无可统计结果',
    hint: input.activeRecordCount > 0
      ? '当前仍有进行中或待完善交易；平仓并补全结果后会进入统计。'
      : '当前记录尚未形成可靠的已平仓结果，可以调整范围或补全交易。',
    primary: input.activeRecordCount > 0 ? 'view-active' : 'adjust-scope',
    primaryLabel: input.activeRecordCount > 0 ? '查看进行中交易' : '调整分析范围',
    secondary: 'create',
    secondaryLabel: '新建交易',
  }
}
