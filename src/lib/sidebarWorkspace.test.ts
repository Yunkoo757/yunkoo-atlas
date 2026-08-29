import type { Trade } from '@/data/trades'
import {
  countCurrentSidebarView,
  countSidebarModuleRecords,
  countSidebarRoute,
  countSidebarTarget,
  normalizeSidebarWorkspaceItems,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function liveTrade(id: string, liveStageId: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    liveStageId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: id === 'historical' ? '2099-12-31' : '2000-01-01',
    closedAt: null,
    note: '',
  }
}

export function testSidebarCurrentLiveCountsUseCurrentStageId(): void {
  const context = {
    trades: [liveTrade('historical', 'stage-old'), liveTrade('current', 'stage-current')],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }

  const count = countSidebarRoute('/active', '', context)

  assert(count === 1, '侧栏进行中计数只能统计 currentLiveStageId')
}

export function testSidebarMissedAggregateCountsExecutionEventsOnly(): void {
  const makeMissed = (id: string, tradeKind: 'live' | 'paper' | 'case', liveStageId?: string): Trade => ({
    ...liveTrade(id, liveStageId ?? 'stage-current'),
    tradeKind,
    status: 'missed',
    ...(tradeKind === 'case' ? { caseType: 'missed' as const } : {}),
    ...(tradeKind === 'paper' ? {} : { liveStageId }),
  } as Trade)
  const context = {
    trades: [
      makeMissed('historical-live', 'live', 'stage-old'),
      makeMissed('current-live', 'live', 'stage-current'),
      makeMissed('historical-case', 'case', 'stage-old'),
      makeMissed('current-case', 'case', 'stage-current'),
      makeMissed('paper', 'paper'),
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }
  const target: Parameters<typeof countSidebarTarget>[0] = {
    item: {
      id: 'system:missed',
      target: { kind: 'system' as const, id: 'missed' as const, workspaces: ['trade', 'paper'] },
      placement: 'pinned' as const,
      order: 0,
    },
    key: 'system:missed',
    label: '错过的机会',
    pathname: '/missed',
    search: '',
    icon: 'missed' as const,
    invalid: false,
  }

  const count = countSidebarTarget(target, context)

  assert(count === 2, '错过计数必须保留 paper 与当前实盘，并排除案例重复计数')
}

export function testStrategyShortcutIsATradeLogFilter(): void {
  const item = resolveSidebarWorkspaceItem(
    {
      id: 'strategy:strategy-1',
      target: { kind: 'strategy', strategyId: 'strategy-1', workspaces: ['trade', 'paper', 'case'] },
      placement: 'pinned',
      order: 0,
    },
    { savedViews: [], strategies: [{ id: 'strategy-1', name: '导航1', icon: 'target', color: '#5e6ad2' }] },
  )
  assert(item.pathname === '/list', '策略快捷入口必须属于交易日志')
  assert(item.search === '?strategyId=strategy-1', '策略快捷入口只能携带策略筛选')
  const normalized = normalizeSidebarWorkspaceItems([item.item])
  assert(
    normalized[0]?.target.kind === 'strategy' && normalized[0].target.workspaces === undefined,
    '旧版策略来源配置必须在归一化时移除',
  )
}

export function testPrimarySidebarModuleCountsUseWholeLibrary(): void {
  const context = {
    trades: [
      liveTrade('historical', 'stage-old'),
      liveTrade('current', 'stage-current'),
      { ...liveTrade('paper', 'stage-current'), tradeKind: 'paper' as const, liveStageId: undefined },
      { ...liveTrade('case', 'stage-current'), tradeKind: 'case' as const },
      { ...liveTrade('deleted', 'stage-current'), deletedAt: '2026-08-29T00:00:00.000Z' },
    ],
  }

  assert(countSidebarModuleRecords('trade', context) === 2, '交易日志模块总量必须包含全部历史实盘并排除回收站')
  assert(countSidebarModuleRecords('case', context) === 1, '案例库模块总量必须只包含未删除案例')
}

export function testPrimarySidebarCountUsesCurrentVisibleList(): void {
  const context = {
    filter: { type: 'all' as const, tradeKind: 'live' as const },
    listPath: '/list',
    listSearch: '?view=starred',
    orderedIds: ['starred-1', 'starred-2', 'starred-3', 'starred-4'],
  }

  assert(
    countCurrentSidebarView('trades', '/list', '?view=starred', context) === 4,
    '交易日志徽标必须等于当前星标视图实际结果数',
  )
  assert(
    countCurrentSidebarView('trades', '/list', '?view=missed', context) === undefined,
    '列表上下文与当前查询不一致时不得显示旧结果数',
  )
  assert(
    countCurrentSidebarView('reviewCases', '/review-cases/focus', '', {
      filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'focus' },
      listPath: '/review-cases/focus',
      listSearch: '',
      orderedIds: ['case-1', 'case-2'],
    }) === 2,
    '案例库徽标必须等于当前案例分类实际结果数',
  )
}

export function testSidebarSelectionSurvivesLegacyWorkspaceRedirects(): void {
  const sources = { savedViews: [], strategies: [] }
  const items = [
    { id: 'system:favorites', target: { kind: 'system' as const, id: 'favorites' as const }, placement: 'pinned' as const, order: 0 },
    { id: 'system:missed', target: { kind: 'system' as const, id: 'missed' as const, workspaces: ['trade' as const] }, placement: 'pinned' as const, order: 1 },
    { id: 'system:paper', target: { kind: 'system' as const, id: 'paper' as const }, placement: 'pinned' as const, order: 2 },
  ].map((item) => resolveSidebarWorkspaceItem(item, sources))

  const redirectedLocations = [
    ['/list', '?view=starred', 'system:favorites'],
    ['/list', '?view=missed', 'system:missed'],
    ['/list', '?kind=paper', 'system:paper'],
  ] as const

  for (const [pathname, search, expectedId] of redirectedLocations) {
    const selection = resolveSidebarSelection({ pathname, search, items })
    if (expectedId === 'system:favorites' || expectedId === 'system:missed') {
      assert(selection.activeWorkspaceItemId === undefined, '配置型快捷视图不得在侧栏制造第二个焦点态')
      assert(selection.primaryContextOnly === false, '交易日志同页快捷视图必须保持一级导航完整高亮')
    } else {
      assert(
        selection.activeWorkspaceItemId === expectedId,
        `${pathname}${search} 必须继续激活重定向前的工作区入口 ${expectedId}`,
      )
      assert(selection.primaryContextOnly === true, '独立工作区入口激活时一级导航只能表达弱上下文')
    }
  }

  const missedTopView = resolveSidebarSelection({ pathname: '/missed', search: '', items: [] })
  assert(missedTopView.activePrimaryId === 'trades', '错过机会顶部视图仍应归属交易日志工作区')
  assert(missedTopView.primaryContextOnly === false, '错过机会属于交易日志本页，一级导航必须保持完整高亮')

  for (const [pathname, search] of [
    ['/review-cases/focus', ''],
    ['/review-cases', '?caseScope=focus'],
    ['/review-cases/mistakes', '?reviewCategory=mistake'],
  ] as const) {
    const caseView = resolveSidebarSelection({ pathname, search, items: [] })
    assert(caseView.activePrimaryId === 'reviewCases', `${pathname}${search} 必须归属案例库`)
    assert(caseView.primaryContextOnly === false, `${pathname}${search} 必须保持案例库完整高亮`)
  }

  const today = resolveSidebarSelection({ pathname: '/list', search: '?view=incomplete', items })
  assert(today.activePrimaryId === 'today', '今日入口重定向后必须继续激活今日导航')
}

export function testCaseSidebarCountIncludesHistoricalCases(): void {
  const context = {
    trades: [
      { ...liveTrade('old-case', 'stage-old'), tradeKind: 'case' as const },
      { ...liveTrade('current-case', 'stage-current'), tradeKind: 'case' as const },
      liveTrade('current-live', 'stage-current'),
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }

  assert(countSidebarRoute('/review-cases', '', context) === 2, '案例记录侧栏计数必须含全部历史案例')
  assert(countSidebarRoute('/review-cases/exemplar', '', context) === 0, '未标记优秀范例时交易案例计数应为 0')
}

export function testStrategySidebarCountUsesCurrentLiveTrades(): void {
  const context = {
    trades: [
      liveTrade('current-live', 'stage-current'),
      liveTrade('old-live', 'stage-old'),
      { ...liveTrade('paper', 'stage-current'), tradeKind: 'paper' as const },
      { ...liveTrade('old-case', 'stage-old'), tradeKind: 'case' as const },
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
    liveStages: [
      {
        id: 'stage-old',
        sequence: 1,
        name: '实盘阶段 1',
        status: 'archived' as const,
        startsOn: '2026-01-01',
        endsOn: '2026-01-31',
        createdAt: '2026-01-01T00:00:00.000Z',
        archivedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'stage-current',
        sequence: 2,
        name: '实盘阶段 2',
        status: 'current' as const,
        startsOn: '2026-02-01',
        endsOn: null,
        createdAt: '2026-02-01T00:00:00.000Z',
        archivedAt: null,
      },
    ],
  }

  const count = countSidebarRoute('/list', '?strategyId=strategy', context)
  const allLiveCount = countSidebarRoute('/list', '?strategyId=strategy&liveStage=all', context)
  const historicalCount = countSidebarRoute('/list', '?strategyId=strategy&liveStage=all-history', context)
  const legacyCount = countSidebarRoute('/strategy/strategy', '?sources=trade,paper,case', context)

  assert(count === 1, '策略计数只能统计当前阶段的对应实盘交易')
  assert(allLiveCount === 2, '全部实盘策略计数必须包含当前及已归档阶段的实盘交易')
  assert(historicalCount === 1, '历史实盘策略计数必须排除当前阶段')
  assert(legacyCount === 1, '旧版跨来源参数必须被忽略，不能重新混入模拟盘与案例')
}
