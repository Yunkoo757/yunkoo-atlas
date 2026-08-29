import { MISSED_PAGE_TITLE } from '@/lib/pageCopy'
import { REVIEW_CASE_SCOPE_LABELS } from '@/lib/reviewCaseScope'
import { REVIEW_STAGE_SOURCE_LABELS } from '@/lib/reviewSession'
import { PRIMARY_NAV_LABELS, SECONDARY_NAV_LABELS } from '@/lib/sidebarNavContract'
import { presentWorkspaceScope } from '@/lib/workspaceScopePresentation'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testPrimaryProductTermsStayCanonical(): void {
  assert(PRIMARY_NAV_LABELS.trades === '交易日志', '交易模块名称必须统一为“交易日志”')
  assert(PRIMARY_NAV_LABELS.dashboard === '统计分析', '分析模块不得恢复旧称“仪表盘”')
  assert(PRIMARY_NAV_LABELS.reviewCases === '案例库', '案例模块名称必须统一为“案例库”')
  assert(PRIMARY_NAV_LABELS.weeklyReview === '周期复盘', '复盘模块名称必须统一为“周期复盘”')
  assert(SECONDARY_NAV_LABELS.missed === '错过机会', '错过视图必须使用统一短名')
  assert(MISSED_PAGE_TITLE === '错过机会', '错过页面标题必须与快捷视图一致')
  assert(
    presentWorkspaceScope({ type: 'missed', tradeKind: 'live' }).summary === '错过机会',
    '错过范围摘要不得另造同义词',
  )
}

export function testStageSourceTermsMatchTheirActualMembership(): void {
  assert(REVIEW_STAGE_SOURCE_LABELS['current-and-history'] === '全部阶段', '全阶段范围必须直称“全部阶段”')
  assert(REVIEW_STAGE_SOURCE_LABELS.current === '仅当前阶段', '当前阶段范围必须明确排除历史')
  assert(REVIEW_STAGE_SOURCE_LABELS['all-history'] === '仅历史阶段', '历史范围不得误称为“全部阶段”')
}

export function testCaseTermsSeparateModuleRecordAndCategory(): void {
  assert(PRIMARY_NAV_LABELS.reviewCases === '案例库', '一级导航必须表达模块')
  assert(REVIEW_CASE_SCOPE_LABELS.focus === '重点案例', '案例分类必须使用完整名称')
  assert(REVIEW_CASE_SCOPE_LABELS.mistakes === '错题', '错题分类不得出现“错题集”等漂移名称')
  assert(REVIEW_CASE_SCOPE_LABELS.missed === '错过案例', '错过案例分类必须与错过机会区分')
}
