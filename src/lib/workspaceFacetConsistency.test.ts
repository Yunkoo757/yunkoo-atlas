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
} from '@/lib/workspaceViews'

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

  assert(!params.has('kind') && !params.has('range'), '离开策略分析页后不得保留失效分析范围')
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
    ) === '案例记录 · 重点案例 · 错误案例 · 待复看',
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
    ) === '案例记录 · 普通',
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

  for (const label of ['案例类型', '掌握状态', '复盘分类', '其他时段', '记录类型']) {
    assert(filters.includes(label), `案例/时段筛选 UI 应展示“${label}”`)
  }
  assert(filters.includes("? 'paper'"), 'TradeFilters 应把模拟页识别为独立 paper workspace')
  assert(filters.includes('quickViews={<QuickViewBar kind={workspaceKind} />}'), '模拟页不得隐藏 QuickViewBar')
  assert(quickViews.includes('PAPER_MORE_GROUPS'), '模拟工作区应提供扩展快捷视图')
  assert(!quickViews.includes("label: '时间',\n    items: [\n      { id: 'paper-week', label: '本周', pathname: '/list'"), '模拟快捷视图不得指向 /list')
}

export function testCrossTypeFacetsShareOneProductionPipelineAndExposeUnsupportedConditions(): void {
  const hook = readFileSync(
    path.resolve('src/hooks/useWorkbenchVisibleTrades.ts'),
    'utf8',
  )
  const filters = readFileSync(
    path.resolve('src/components/trades/TradeFilters.tsx'),
    'utf8',
  )
  const strategyHeader = readFileSync(
    path.resolve('src/components/StrategyHeader.tsx'),
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
    filters.includes('未支持条件：${key}=${value}') &&
      filters.includes("item.key.startsWith('unsupported:')"),
    '未知保存条件必须可见且可清除，不能静默改变列表语义',
  )
  assert(
    strategyHeader.includes('filterTradesByFacets(scoped, facets)'),
    '策略头部统计必须与当前列表 facets 使用同一记录集合',
  )
}
