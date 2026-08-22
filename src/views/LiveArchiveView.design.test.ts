import { getTradesPageSubtitle } from '@/lib/pageCopy'
import {
  getActiveWorkspaceView,
  getWorkspacePrimaryViews,
  searchForWorkspaceViewTarget,
} from '@/lib/workspaceViews'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testHistoricalLivePublishesStandardWorkbenchQuickViews(): void {
  const trades = getWorkspacePrimaryViews('historical-trade')
  const cases = getWorkspacePrimaryViews('historical-case')

  assert(
    trades.map((view) => view.label).join() === '全部,本周,本月,亏损,关联案例',
    '历史实盘必须沿用交易工作台的主快捷视图结构',
  )
  assert(
    cases.map((view) => view.label).join() === '实盘记录,全部,重点,错题,错过机会,待复看,已掌握',
    '历史关联案例必须沿用案例工作台的分类结构',
  )
  assert(
    [...trades, ...cases].every((view) => view.pathname === '/live-history'),
    '历史快捷视图只能改变筛选，不得跳回当前交易日志或案例模块',
  )
}

export function testHistoricalQuickViewsReplaceIdentityWithoutLeakingOldFilters(): void {
  const casesTarget = getWorkspacePrimaryViews('historical-trade')
    .find((view) => view.id === 'historical-cases')
  assert(casesTarget, '历史实盘必须提供关联案例入口')
  assert(
    searchForWorkspaceViewTarget('?status=loss&period=this-month', casesTarget) === '?view=cases',
    '切换关联案例时必须清理交易视图身份筛选',
  )

  const active = getActiveWorkspaceView(
    'historical-case',
    '/live-history',
    '?view=cases&caseScope=mistakes',
  )
  assert(active?.id === 'mistakes', '历史案例快捷视图必须正确恢复选中态')
}

export function testHistoricalLiveUsesSharedWorkbenchSubtitleContract(): void {
  assert(
    getTradesPageSubtitle({ type: 'all', tradeKind: 'live', historicalLiveScope: 'trades' }) === '历史阶段的实盘交易',
    '历史实盘必须通过共享 Topbar 副标题使用阶段语言说明数据范围',
  )
  assert(
    getTradesPageSubtitle({ type: 'all', tradeKind: 'case', historicalLiveScope: 'cases' }) === '历史阶段的关联案例',
    '历史案例必须通过共享 Topbar 副标题使用阶段语言说明来源范围',
  )
}
