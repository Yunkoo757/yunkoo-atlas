import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import {
  getActiveWorkspaceView,
  getWorkspacePrimaryViews,
  searchForWorkspaceViewTarget,
} from '@/lib/workspaceViews'

function archiveCss(): string {
  return readFileSync(path.resolve('src/views/LiveArchiveView.css'), 'utf8').replace(/\r\n?/g, '\n')
}

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

export function testCurrentCaseWorkspaceDoesNotRepeatItsPurposeInTheTitle(): void {
  assert(
    getTradesPageSubtitle({ type: 'all', tradeKind: 'case' }) === undefined,
    '案例记录标题后不得重复显示“独立复盘”说明',
  )
}

export function testHistoricalArchiveNavIsCompactAndShared(): void {
  const css = archiveCss()
  assert(css.includes('.live-archive-navigation'), '阶段与标签必须共享一个导航区')
  assert(!/min-height:\s*58px/.test(css), '阶段条不得再使用厚卡片高度')
  assert(!/min-width:\s*120px/.test(css), '阶段选项不得再使用大块最小宽度')
  assert(
    css.includes('--type-row-size') || css.includes('--type-body-size'),
    '阶段名称必须使用正文/行级 token',
  )
  assert(css.includes('--type-metadata-size'), '阶段日期必须使用元信息 token')
}

export function testHistoricalArchiveDropsTripleCardNesting(): void {
  const css = archiveCss()
  assert(!/background:\s*var\(--bg-inset\)/.test(css) || !css.includes('.live-archive-panel'), '主体不得再做 inset 背景页加外层大卡')
  assert(
    /border:\s*0/.test(css) || !/border:\s*1px solid var\(--border-subtle\)/.test(
      css.slice(css.indexOf('.live-archive-panel'), css.indexOf('.live-archive-summary-grid')),
    ),
    '概览外层 panel 必须去掉厚重卡片边框',
  )
}
