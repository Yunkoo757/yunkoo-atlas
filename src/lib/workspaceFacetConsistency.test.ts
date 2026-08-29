import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import {
  canonicalizeTradeViewSearch,
  normalizeSavedTradeViews,
  savedViewMatchesLocation,
  savedViewSearch,
  suggestSavedViewName,
} from '@/lib/savedTradeViews'
import { filterTradesByFacets } from '@/lib/tradeView'
import {
  getWorkbenchVisibleTrades,
  parseTradeFacets,
  serializeTradeFacets,
} from '@/lib/workbenchTrades'
import {
  getActiveWorkspaceView,
  getWorkspacePrimaryViews,
  isSavedViewInWorkspace,
  searchForWorkspaceViewTarget,
  syncPrimaryWorkspaceMode,
} from '@/lib/workspaceViews'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'
import {
  describeListFilterDateField,
  resolveTradeLogFilter,
} from '@/lib/tradeFilters'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { createBusinessDateAnchor } from '@/lib/periods'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const caseTrade: Trade = {
  id: 'case-1',
  ref: 'CAS-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'loss',
  conviction: 'medium',
  strategyId: 'strategy-1',
  session: 'Sydney Open',
  tags: ['结构突破'],
  mistakeTags: ['追涨'],
  reviewStatus: 'focus',
  reviewCategory: 'focus',
  tradeKind: 'case',
  caseType: 'mistake',
  masteryState: 'recheck',
  entry: 100,
  exit: 95,
  size: 1,
  pnl: -5,
  rMultiple: -1,
  resultSource: 'imported',
  openedAt: '2026-07-16T08:00:00.000Z',
  closedAt: '2026-07-16T09:00:00.000Z',
  note: '<p>案例复盘</p>',
}

export function testMissedQuickViewBelongsToAccountTradeWorkspacesOnly(): void {
  const tradeOnlyMissed: SidebarWorkspaceItem[] = [{
    id: 'system:missed',
    target: { kind: 'system', id: 'missed', workspaces: ['trade'] },
    placement: 'pinned',
    order: 0,
  }]

  assert(
    getWorkspacePrimaryViews('paper', tradeOnlyMissed).some((view) => view.id === 'missed'),
    '模拟盘仍应提供账户交易的错过快捷视图',
  )
  assert(
    !getWorkspacePrimaryViews('case', tradeOnlyMissed).some((view) => view.id === 'missed'),
    '案例库不得再提供与交易日志重名的错过机会视图',
  )
  assert(
    !getWorkspacePrimaryViews('paper', tradeOnlyMissed).some((view) => view.id === 'open'),
    '进行中快捷视图仍应遵循可见工作区过滤',
  )
}

export function testCaseFacetsRoundTripThroughUrlAndMatchTheSameRecords(): void {
  const facets = {
    caseType: 'mistake' as const,
    masteryState: 'recheck' as const,
    reviewCategory: 'focus' as const,
    session: 'other' as const,
    strategyId: 'strategy-1',
  }
  const serialized = serializeTradeFacets(facets)
  const parsed = parseTradeFacets(serialized)

  assert(parsed.caseType === facets.caseType, 'caseType 应完成 URL 往返')
  assert(parsed.masteryState === facets.masteryState, 'masteryState 应完成 URL 往返')
  assert(parsed.reviewCategory === facets.reviewCategory, 'reviewCategory 应完成 URL 往返')
  assert(parsed.session === 'other', '自定义交易时段应解析为 other')

  const matched = filterTradesByFacets(
    [
      caseTrade,
      { ...caseTrade, id: 'case-2', caseType: 'exemplar' },
      { ...caseTrade, id: 'case-3', masteryState: 'mastered' },
    ],
    parsed,
  )
  assert(matched.length === 1 && matched[0]?.id === caseTrade.id, '案例 facet 应使用 AND 口径')

  const visible = getWorkbenchVisibleTrades({
    trades: [caseTrade, { ...caseTrade, id: 'case-2', caseType: 'exemplar' }],
    filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: serialized,
  })
  assert(visible.length === 1 && visible[0]?.id === caseTrade.id, '列表与 facet 纯匹配必须同义')
}

export function testCrossTypeWorkspacesCanFilterAndSaveRecordType(): void {
  const liveTrade: Trade = {
    ...caseTrade,
    id: 'live-1',
    ref: 'TRD-1',
    tradeKind: 'live',
    caseType: undefined,
    masteryState: undefined,
  }
  const paperTrade: Trade = {
    ...liveTrade,
    id: 'paper-1',
    ref: 'TRD-2',
    tradeKind: 'paper',
  }
  const serialized = serializeTradeFacets({ tradeKind: 'paper', strategyId: 'strategy-1' })
  const parsed = parseTradeFacets(serialized)
  assert(parsed.tradeKind === 'paper', '记录类型必须完成 URL 往返')

  const visible = getWorkbenchVisibleTrades({
    trades: [liveTrade, paperTrade],
    filter: { type: 'strategy', strategyId: 'strategy-1' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: serialized,
  })
  assert(visible.length === 1 && visible[0]?.id === paperTrade.id, '跨类型策略页必须能只看模拟记录')

  const fixedLive = getWorkbenchVisibleTrades({
    trades: [liveTrade, paperTrade],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: '?tradeKind=paper',
  })
  assert(fixedLive.length === 1 && fixedLive[0]?.id === liveTrade.id, '固定类型工作区必须忽略陈旧类型参数')

  const [saved] = normalizeSavedTradeViews([{
    id: 'paper-strategy',
    name: '模拟策略记录',
    pathname: '/strategy/strategy-1',
    search: { tradeKind: 'paper' },
    pinned: false,
    order: 0,
    createdAt: '2026-07-16T08:00:00.000Z',
    updatedAt: '2026-07-16T08:00:00.000Z',
  }])
  assert(saved?.search.tradeKind === 'paper', '保存视图必须保留合法记录类型')
  assert(savedViewSearch(saved!) === '?tradeKind=paper', '恢复链接必须保留记录类型')
  assert(
    suggestSavedViewName('/strategy/strategy-1', new URLSearchParams('tradeKind=paper')) === '模拟',
    '保存视图名称必须向用户说明记录类型',
  )
}

export function testTradeLogEnablesAnalysisOnlyForExplicitKindOrRange(): void {
  const ordinary = resolveTradeLogFilter('?symbol=BTCUSDT')
  const live = resolveTradeLogFilter('?kind=live&range=all&symbol=BTCUSDT')
  const paper = resolveTradeLogFilter('?kind=paper&range=30d')
  const combined = resolveTradeLogFilter('?kind=all&range=this-week')

  assert(ordinary.tradeKind === 'live' && ordinary.analysisScope === undefined, '普通 /list 必须保留默认实盘工作区语义')
  assert(live.analysisScope?.kind === 'live' && live.analysisScope.range === 'all', '显式实盘下钻必须启用绩效范围')
  assert(paper.analysisScope?.kind === 'paper' && paper.analysisScope.range === '30d', '显式模拟下钻必须启用绩效范围')
  assert(combined.analysisScope?.kind === 'all' && combined.analysisScope.range === 'this-week', '组合下钻必须保留自然范围')
  assert(live.tradeKind === undefined && paper.tradeKind === undefined && combined.tradeKind === undefined, '分析下钻不得被固定 live facet 截断')

  const app = readFileSync(path.resolve('src/App.tsx'), 'utf8')
  assert(app.includes('resolveTradeWorkspaceListFilter(query)'), '/list 与 /board 路由必须消费统一工作台查询解析器')
}

export function testCalendarPeriodsAndDashboardPerformanceKeepDifferentDateFields(): void {
  const anchor = createBusinessDateAnchor(new Date(2026, 7, 9, 12), 6)
  const display = { ...DEFAULT_DISPLAY, hideClosed: false, tradingDayStartHour: 6 }
  const openedThisYear = {
    ...caseTrade,
    id: 'opened-this-year',
    ref: 'TRD-OPENED-YTD',
    tradeKind: 'live' as const,
    openedAt: '2026-01-02',
    closedAt: '2025-12-31',
    closedTradingDayKey: '2025-12-31',
  }
  const closedThisYear = {
    ...openedThisYear,
    id: 'closed-this-year',
    ref: 'TRD-CLOSED-YTD',
    openedAt: '2025-12-31',
    closedAt: '2026-01-02',
    closedTradingDayKey: '2026-01-02',
  }

  const calendarIds = getWorkbenchVisibleTrades({
    trades: [openedThisYear, closedThisYear],
    filter: { type: 'period', period: 'ytd', tradeKind: 'live' },
    starredIds: [],
    display,
    search: '',
    businessDateAnchor: anchor,
  }).map((trade) => trade.id)
  const performanceIds = getWorkbenchVisibleTrades({
    trades: [openedThisYear, closedThisYear],
    filter: resolveTradeLogFilter('?kind=live&range=ytd'),
    starredIds: [],
    display,
    search: '?kind=live&range=ytd',
    businessDateAnchor: anchor,
  }).map((trade) => trade.id)

  assert(calendarIds.join() === 'opened-this-year', '普通 /period/ytd 必须按开仓日筛选')
  assert(performanceIds.join() === 'closed-this-year', 'Dashboard 本年下钻必须继续按可靠平仓日筛选')
  assert(
    describeListFilterDateField({ type: 'period', period: 'ytd', tradeKind: 'live' }) === '按开仓日',
    '普通 period 副标题必须说明开仓日字段',
  )
  assert(
    describeListFilterDateField(resolveTradeLogFilter('?kind=live&range=ytd')) === '按可靠平仓日',
    '绩效下钻副标题必须说明可靠平仓日字段',
  )
}

export function testWorkbenchAnalysisMatchesSelectorAcrossKindsRangesAndArchive(): void {
  const archivedLive = { ...caseTrade, id: 'archived-live', ref: 'TRD-ARCHIVED', tradeKind: 'live' as const, liveStageId: 'stage-old', openedAt: '2099-06-15', closedAt: '2099-06-15', closedTradingDayKey: '2099-06-15' }
  const currentLive = { ...archivedLive, id: 'current-live', ref: 'TRD-CURRENT', liveStageId: 'stage-current', openedAt: '2026-08-08', closedAt: '2026-08-08', closedTradingDayKey: '2026-08-08' }
  const openCurrent = { ...currentLive, id: 'open-current', ref: 'TRD-OPEN', status: 'open' as const, closedAt: null, closedTradingDayKey: undefined, pnl: null, rMultiple: null, resultSource: undefined }
  const historicalPaper = { ...archivedLive, id: 'historical-paper', ref: 'TRD-PAPER', tradeKind: 'paper' as const }
  const trades = [archivedLive, currentLive, openCurrent, historicalPaper]
  const anchor = createBusinessDateAnchor(new Date(2026, 7, 9, 12), 6)
  const display = { ...DEFAULT_DISPLAY, hideClosed: false, tradingDayStartHour: 6 }

  const ordinary = getWorkbenchVisibleTrades({
    trades,
    filter: resolveTradeLogFilter(''),
    starredIds: [],
    display,
    search: '',
    businessDateAnchor: anchor,
    stageScope: { kind: 'current', stageId: 'stage-current' },
  })
  assert(ordinary.map((trade) => trade.id).sort().join() === 'current-live,open-current', '普通 /list 必须保留当前实盘日志并包含未平仓记录')

  const matrix = [
    { search: '?kind=live&range=all&liveStage=current', scope: { kind: 'live' as const, range: 'all' as const } },
    { search: '?kind=paper&range=all', scope: { kind: 'paper' as const, range: 'all' as const } },
    { search: '?kind=all&range=all&liveStage=current', scope: { kind: 'all' as const, range: 'all' as const } },
    { search: '?kind=all&range=30d&liveStage=current', scope: { kind: 'all' as const, range: '30d' as const } },
  ]
  for (const entry of matrix) {
    const stageTrades = trades.filter((item) => item.tradeKind === 'paper' || item.liveStageId === 'stage-current')
    const expected = buildPerformanceSelection(stageTrades, {
      scope: entry.scope,
      anchor,
      legacyCashCurrencyAssumption: { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
    }).eligibleMetricIds
    const actual = getWorkbenchVisibleTrades({
      trades,
      filter: resolveTradeLogFilter(entry.search),
      starredIds: [],
      display,
      search: entry.search,
      businessDateAnchor: anchor,
      stageScope: { kind: 'current', stageId: 'stage-current' },
    }).map((trade) => trade.id)
    const expectedIds = new Set(expected)
    const actualIds = new Set(actual)
    const delta = [
      ...expected.filter((id) => !actualIds.has(id)),
      ...actual.filter((id) => !expectedIds.has(id)),
    ]
    assert(delta.length === 0, `${entry.search} 的 workbench/selector 双向差集必须为 0：${delta.join(',')}`)
  }
}

export function testInvalidCaseFacetValuesAreIgnoredInsteadOfHidingEverything(): void {
  const parsed = parseTradeFacets(
    '?caseType=unknown&masteryState=done&reviewCategory=invalid&session=custom',
  )
  assert(parsed.caseType === undefined, '非法 caseType 不得进入筛选条件')
  assert(parsed.masteryState === undefined, '非法 masteryState 不得进入筛选条件')
  assert(parsed.reviewCategory === undefined, '非法 reviewCategory 不得进入筛选条件')
  assert(parsed.session === undefined, '非法 session 不得进入筛选条件')
  assert(parseTradeFacets('?tradeKind=case').tradeKind === undefined, '案例不得伪装成账户记录类型 facet')
}

export function testKnownInvalidFacetValuesAreCanonicalizedWithoutDroppingUnknownParams(): void {
  const canonical = canonicalizeTradeViewSearch(
    '?caseType=unknown&masteryState=done&reviewCategory=invalid&session=custom' +
      '&status=archived&side=flat&period=quarter&tradeKind=case&symbol=BTCUSDT&source=legacy',
  )

  for (const key of [
    'caseType',
    'masteryState',
    'reviewCategory',
    'session',
    'status',
    'side',
    'period',
    'tradeKind',
  ]) {
    assert(!canonical.has(key), `非法 ${key} 应从 URL 移除`)
  }
  assert(canonical.get('symbol') === 'BTCUSDT', '自由文本 facet 不得被误删')
  assert(canonical.get('source') === 'legacy', '未知参数不得被误删')
}

export function testSavedViewsDoNotPersistKnownInvalidFacetValues(): void {
  const [saved] = normalizeSavedTradeViews([
    {
      id: 'dirty-view',
      name: '旧筛选',
      pathname: '/review-cases',
      search: {
        caseType: 'unknown',
        masteryState: 'done',
        reviewCategory: 'invalid',
        session: 'custom',
        tradeKind: 'case',
        symbol: 'BTCUSDT',
        source: 'legacy',
      },
      pinned: false,
      order: 0,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T08:00:00.000Z',
    },
  ])

  assert(saved?.search.symbol === 'BTCUSDT', '保存视图应保留自由文本 facet')
  assert(saved?.search.source === 'legacy', '保存视图应保留未知参数')
  assert(saved?.search.caseType === undefined, '保存视图不得持久化非法 caseType')
  assert(saved?.search.masteryState === undefined, '保存视图不得持久化非法 masteryState')
  assert(saved?.search.reviewCategory === undefined, '保存视图不得持久化非法复盘分类')
  assert(saved?.search.session === undefined, '保存视图不得持久化非法时段')
  assert(saved?.search.tradeKind === undefined, '保存视图不得持久化非法记录类型')
  assert(
    savedViewSearch(saved!) === '?source=legacy&symbol=BTCUSDT',
    '恢复链接应只包含 canonical 查询条件',
  )
}

export function testPaperWorkspaceViewsStayOnSimAcrossListBoardSaveAndRestore(): void {
  const primary = getWorkspacePrimaryViews('paper')
  assert(primary.length >= 4, '模拟工作区应提供直接可用的快捷视图')
  assert(primary.every((view) => view.pathname === '/sim'), '模拟快捷视图不得跳到 /list')
  assert(
    getActiveWorkspaceView('paper', '/sim/board', '?status=planned&symbol=BTCUSDT')?.id ===
      'planned',
    '模拟看板叠加临时品种条件时仍应识别快捷视图',
  )

  const switched = searchForWorkspaceViewTarget('?status=loss&period=this-week&symbol=BTCUSDT', {
    id: 'open',
    search: '?status=open',
  })
  assert(
    switched === '?symbol=BTCUSDT&status=open',
    '切换模拟快捷视图应替换身份条件并保留临时 facet',
  )
  assert(
    searchForWorkspaceViewTarget(switched, { id: 'all' }) === '',
    '模拟「全部」与清除筛选应得到相同空查询',
  )

  const [saved] = normalizeSavedTradeViews([
    {
      id: 'paper-view',
      name: '模拟待执行',
      pathname: '/sim/board',
      search: { status: 'planned' },
      pinned: true,
      order: 0,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T08:00:00.000Z',
    },
  ])
  assert(saved?.pathname === '/sim', '保存模拟看板视图时应只移除模式后缀')
  assert(
    savedViewMatchesLocation(saved!, '/sim/board', '?status=planned'),
    '同一模拟保存视图应同时匹配列表与看板',
  )
  assert(isSavedViewInWorkspace(saved!, 'paper'), '模拟保存视图应回到模拟工作区')
  assert(!isSavedViewInWorkspace(saved!, 'trade'), '模拟保存视图不得混入实盘工作区')

}

export function testQuickViewsDropStaleAnalysisScopeButPreserveTransientAndUnknownParams(): void {
  const switched = searchForWorkspaceViewTarget(
    '?kind=paper&range=30d&symbol=BTCUSDT&source=weekly',
    { id: 'loss', search: '?status=loss' },
  )
  const params = new URLSearchParams(switched)

  assert(params.get('kind') === 'paper' && !params.has('range'), '快捷视图必须保留公共盘型并移除页面私有分析周期')
  assert(params.get('status') === 'loss', '快捷视图身份条件应写入目标 URL')
  assert(params.get('symbol') === 'BTCUSDT', '临时 facet 应跨快捷视图保留')
  assert(params.get('source') === 'weekly', '真正未知的参数不得被误删')
}

export function testLegacyPaperSavedViewsNormalizeIntoTheSimWorkspace(): void {
  for (const pathname of [
    '/paper',
    '/paper/',
    '/paper/board',
    '/practice',
    '/practice/',
    '/practice/board',
  ]) {
    const [saved] = normalizeSavedTradeViews([
      {
        id: `legacy-${pathname}`,
        name: '旧模拟视图',
        pathname,
        search: { status: 'loss' },
        pinned: true,
        order: 0,
        createdAt: '2026-07-16T08:00:00.000Z',
        updatedAt: '2026-07-16T08:00:00.000Z',
      },
    ])

    assert(saved?.pathname === '/sim', `${pathname} 应归一到 /sim`)
    assert(isSavedViewInWorkspace(saved!, 'paper'), `${pathname} 应回到模拟工作区`)
    assert(
      savedViewMatchesLocation(saved!, '/sim/board', '?status=loss'),
      `${pathname} 应在模拟列表与看板中恢复相同筛选`,
    )
  }
}

export function testSavedViewNamesCoverCaseFacetsAndOtherSession(): void {
  assert(
    suggestSavedViewName(
      '/review-cases',
      new URLSearchParams('caseType=mistake&masteryState=recheck&reviewCategory=focus'),
    ) === '案例库 · 重点案例 · 错误案例 · 待复看',
    '案例保存视图名称应表达三类学习 facet',
  )
  assert(
    suggestSavedViewName('/sim', new URLSearchParams('status=loss&session=other')) ===
      '模拟 · 亏损 · 其他时段',
    '模拟保存视图名称应识别其他时段',
  )
}

export function testSavedViewNameLocalizesTheNormalReviewCategory(): void {
  assert(
    suggestSavedViewName(
      '/review-cases',
      new URLSearchParams('reviewCategory=normal'),
    ) === '案例库 · 普通',
    '普通复盘分类不得把内部 enum 暴露给用户',
  )
}

export function testSavedViewNameIncludesPaperPeriodAndStrategy(): void {
  assert(
    suggestSavedViewName(
      '/sim',
      new URLSearchParams('period=this-week&strategyId=strategy-1&status=loss'),
      '突破策略',
    ) === '模拟 · 本周 · 突破策略 · 亏损',
    '模拟保存视图名称应表达时间范围、策略与结果条件',
  )
}

export function testFilterUiExposesCaseFacetsAndPaperQuickViews(): void {
  const filters = readFileSync(
    path.resolve('src/components/trades/TradeFilters.tsx'),
    'utf8',
  )
  const quickViews = readFileSync(
    path.resolve('src/components/trades/QuickViewBar.tsx'),
    'utf8',
  )

  for (const label of ['案例类型', '掌握状态', '其他时段', '记录类型']) {
    assert(filters.includes(label), `案例/时段筛选 UI 应展示“${label}”`)
  }
  assert(filters.includes("? 'paper'"), 'TradeFilters 应把模拟页识别为独立 paper workspace')
  assert(filters.includes('quickViews={<QuickViewBar kind={workspaceKind} />}'), '模拟页不得隐藏 QuickViewBar')
  assert(quickViews.includes('PAPER_MORE_GROUPS'), '模拟工作区应提供扩展快捷视图')
  assert(!quickViews.includes("label: '时间',\n    items: [\n      { id: 'paper-week', label: '本周', pathname: '/list'"), '模拟快捷视图不得指向 /list')
}

export function testCrossTypeFacetsShareOneProductionPipelineAndNormalizeUnsupportedConditions(): void {
  const hook = readFileSync(
    path.resolve('src/hooks/useWorkbenchVisibleTrades.ts'),
    'utf8',
  )
  const filters = readFileSync(
    path.resolve('src/components/trades/TradeFilters.tsx'),
    'utf8',
  )
  const workspaceQuery = readFileSync(
    path.resolve('src/lib/tradeWorkspaceQuery.ts'),
    'utf8',
  )

  assert(
    hook.includes('deriveWorkbenchVisibleTrades({'),
    '列表与看板必须复用同一条可见记录计算链',
  )
  assert(
    filters.includes("if (!allowsTradeKindFacet) canonical.delete('tradeKind')"),
    '固定类型工作区必须从 URL 移除陈旧记录类型条件',
  )
  assert(
    !filters.includes('未支持的筛选条件，可移除') &&
      workspaceQuery.includes('if (!isKnownTradeViewParam(key)) next.delete(key)'),
    '未知条件必须在工作台入口规范化，不得进入可见筛选状态',
  )
}

export function testTradePrimaryViewsOwnStarredAndMissedClassification(): void {
  const views = getWorkspacePrimaryViews('trade')
  assert(
    views.some((view) => view.id === 'starred' && view.pathname === '/list' && view.search === '?view=starred'),
    '星标交易必须作为交易日志同页快捷视图承载',
  )
  assert(
    views.some((view) => view.id === 'missed' && view.pathname === '/list' && view.search === '?view=missed'),
    '错过机会必须作为交易日志同页快捷视图承载',
  )
  assert(
    !getWorkspacePrimaryViews('case').some((view) => view.id === 'missed'),
    '案例库不得继续暴露错过机会快捷视图',
  )
}

export function testTradeAndCaseWorkspacesShareTheSelectedWorkbenchMode(): void {
  const boardMemory = syncPrimaryWorkspaceMode({
    today: { pathname: '/today-record', search: '?view=incomplete' },
    trade: { pathname: '/period/this-month', search: '?status=loss' },
    case: { pathname: '/review-cases/focus', search: '?tag=HTF' },
  }, 'board')

  assert(boardMemory.trade?.pathname === '/period/this-month/board', '交易日志应切换为看板路由')
  assert(boardMemory.case?.pathname === '/review-cases/focus/board', '案例库应同步切换为看板路由')
  assert(boardMemory.trade?.search === '?status=loss', '同步视图不得丢失交易日志筛选')
  assert(boardMemory.case?.search === '?tag=HTF', '同步视图不得丢失案例库筛选')
  assert(boardMemory.today?.pathname === '/today-record', '共享视图不应改写今日工作台')

  const listMemory = syncPrimaryWorkspaceMode(boardMemory, 'list')
  assert(listMemory.trade?.pathname === '/period/this-month', '交易日志应恢复列表路由')
  assert(listMemory.case?.pathname === '/review-cases/focus', '案例库应同步恢复列表路由')
}
