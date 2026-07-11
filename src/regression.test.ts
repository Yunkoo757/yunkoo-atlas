import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY, filterTrades, applyDisplayPrefs } from '@/lib/tradeFilters'
import { mergeImportPayload, parseImportJson } from '@/lib/importExport'
import { collectTagOptions, mergeTagPresets } from '@/lib/tags'
import { computeStrategyStats } from '@/lib/strategies'
import {
  defaultTradeKindForPath,
  isAccountTrade,
  isReviewCaseTrade,
  normalizeTradeKind,
} from '@/lib/tradeKind'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { buildTradeTableRow } from '@/lib/tradeTable'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import { clampPopoverLeft } from '@/lib/popoverPosition'
import { isHiddenWhenClosedFilter } from '@/lib/tradeStatus'
import {
  attachImagesToPreviewsBySourceId,
  applyNotionImageAssetsToNote,
  executeNotionImport,
  getImportableNotionPreviews,
  notionBodyMarkdownToHtml,
  parseNotionMd,
  type ImageFile,
  type NotionTradePreview,
  parseNotionZip,
  parseNotionCsv,
} from '@/lib/notionImport'
import { cleanExpiredTradeTrash } from '@/lib/trashCleanup'
import { PRIMARY_NAV } from '@/lib/sidebarNav'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'
import { detectSymbolMarket, normalizeSymbol, resolveSymbolIcon, collectSymbolOptions, normalizeSymbolCatalog, DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import { normalizeTimeframe, resolveTimeframe, getTimeframeTone } from '@/data/trades'
import { chordFromEvent } from '@/shortcuts/chords'
import {
  mergeSavedTradeViews,
  normalizeSavedTradeViews,
  savedViewMatchesLocation,
  suggestSavedViewName,
} from '@/lib/savedTradeViews'
import {
  filterTradesByFacets,
  getReviewCaseActivityTime,
  getTradeSessionMeta,
  getSessionSelectValue,
  getVisibleTradeTags,
  groupTradesByMonth,
  intersectSelectedTradeIds,
  normalizeSession,
  normalizePsychology,
  promoteTradeNotionMeta,
  promoteTradeSession,
  routeWithSearch,
  sortReviewCasesByRecentActivity,
  sortTradesByOpenedAtDesc,
} from '@/lib/tradeView'
import {
  getActiveWorkspaceView,
  getWorkspacePrimaryViews,
  isSavedViewInWorkspace,
  resolveWorkspaceNavTarget,
  rememberableWorkspaceKind,
} from '@/lib/workspaceViews'
import { normalizeDisplay } from '@/lib/tradeFilters'
import {
  partitionDisplayActivities,
  type DisplayActivityEvent,
} from '@/lib/activities'
import { syncEditorLightboxEditable } from '@/editor/Editor'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testShortcutRecorderIgnoresModifierOnlyKeydowns(): void {
  const shift = chordFromEvent({
    key: 'Shift',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)
  const alt = chordFromEvent({
    key: 'Alt',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: true,
  } as KeyboardEvent)

  assert(shift.key === '', '录入组合键时不得把 Shift 自身保存为主键')
  assert(alt.key === '', '录入组合键时不得把 Alt 自身保存为主键')
}

export function testQuickCaptureDefaultsFollowRouteContext(): void {
  assert(defaultTradeKindForPath('/today-record') === 'live', '今日记录默认创建实盘交易')
  assert(defaultTradeKindForPath('/review-cases') === 'case', '案例记录默认创建案例')
  assert(defaultTradeKindForPath('/review-cases/mistakes') === 'case', '案例子视图保持案例类型')
  assert(defaultTradeKindForPath('/sim') === 'paper', '模拟页默认创建模拟交易')
  assert(defaultTradeKindForPath('/paper/archive') === 'paper', 'paper 子路径保持模拟类型')
  assert(defaultTradeKindForPath('/practice') === 'paper', '旧 practice 路径兼容模拟类型')
  assert(defaultTradeKindForPath('/list') === 'live', '普通交易列表默认创建实盘交易')
}

export function testPrimarySidebarNavigationMatchesApprovedArchitecture(): void {
  const routes = PRIMARY_NAV.map((item) => item.to)
  const expected = ['/today-record', '/list', '/review-cases', '/dashboard']
  assert(
    JSON.stringify(routes) === JSON.stringify(expected),
    `一级导航应为 ${expected.join(', ')}，实际为 ${routes.join(', ')}`,
  )
  assert(
    routes.every((route) => !route.startsWith('/period/') && !route.startsWith('/strategy/')),
    '时间和策略路由不得出现在一级侧栏导航',
  )
}

export function testWorkspaceViewsNeverCrossRecordDomains(): void {
  const tradeViews = getWorkspacePrimaryViews('trade')
  const caseViews = getWorkspacePrimaryViews('case')

  assert(
    tradeViews.every((view) => !view.pathname.startsWith('/review-cases')),
    '交易日志顶部不得出现案例记录入口',
  )
  assert(
    caseViews.every((view) => view.pathname.startsWith('/review-cases')),
    '案例记录顶部不得出现交易日志入口',
  )
  assert(
    getActiveWorkspaceView('trade', '/list', '?status=loss&symbol=EURUSD')?.id === 'loss',
    '亏损视图叠加临时条件时仍应保持选中',
  )
  assert(
    getActiveWorkspaceView('case', '/review-cases/mistakes', '?symbol=EURUSD')?.id === 'mistakes',
    '错题视图叠加临时条件时仍应保持选中',
  )
  assert(
    isSavedViewInWorkspace({ pathname: '/review-cases/focus' }, 'case') &&
      !isSavedViewInWorkspace({ pathname: '/review-cases/focus' }, 'trade'),
    '保存视图只能显示在所属模块内',
  )
}

export function testWorkspaceNavRemembersLastQuickView(): void {
  assert(rememberableWorkspaceKind('/period/this-week') === 'trade', '本周应记入交易工作区')
  assert(rememberableWorkspaceKind('/list') === 'trade', '全部列表应记入交易工作区')
  assert(rememberableWorkspaceKind('/today-record') === null, '今日记录不占用交易日志记忆')
  assert(rememberableWorkspaceKind('/review-cases/mistakes') === 'case', '错题应记入案例工作区')

  const remembered = resolveWorkspaceNavTarget('trade', {
    pathname: '/period/this-week',
    search: '',
  })
  assert(
    remembered.pathname === '/period/this-week',
    '侧栏交易日志应还原上次快捷视图',
  )

  const loss = resolveWorkspaceNavTarget('trade', {
    pathname: '/list',
    search: '?status=loss',
  })
  assert(loss.search === '?status=loss', '亏损筛选应随记忆一并还原')

  const fallback = resolveWorkspaceNavTarget('trade', {
    pathname: '/settings',
    search: '',
  })
  assert(fallback.pathname === '/list', '非法记忆应回退到全部')

  const display = normalizeDisplay({
    workspaceMemory: {
      trade: { pathname: '/period/this-month', search: '' },
      case: { pathname: '/review-cases/focus', search: '' },
    },
  })
  assert(
    display.workspaceMemory?.trade?.pathname === '/period/this-month' &&
      display.workspaceMemory?.case?.pathname === '/review-cases/focus',
    'workspaceMemory 应经 normalizeDisplay 持久化保留',
  )
}

export function testReviewCasesSortByCollectionAndRecentActivity(): void {
  const collectedRecently: Trade = {
    ...trade,
    id: 'old-source-new-case',
    tradeKind: 'case',
    openedAt: '2025-01-10T00:00:00.000Z',
    recordedAt: '2026-07-08T00:00:00.000Z',
  }
  const editedRecently: Trade = {
    ...trade,
    id: 'recently-edited-case',
    tradeKind: 'case',
    openedAt: '2026-07-01T00:00:00.000Z',
    recordedAt: '2026-07-02T00:00:00.000Z',
    activities: [
      { id: 'edit', kind: 'note', timestamp: '2026-07-09T00:00:00.000Z' },
    ],
  }
  const sourceRecentlyOpened: Trade = {
    ...trade,
    id: 'new-source-old-case',
    tradeKind: 'case',
    openedAt: '2026-07-09T00:00:00.000Z',
    recordedAt: '2026-06-01T00:00:00.000Z',
  }

  assert(
    getReviewCaseActivityTime(collectedRecently) > getReviewCaseActivityTime(sourceRecentlyOpened),
    '案例排序时间应优先使用收录时间而不是来源交易日期',
  )
  assert(
    JSON.stringify(
      sortReviewCasesByRecentActivity([
        sourceRecentlyOpened,
        collectedRecently,
        editedRecently,
      ]).map((item) => item.id),
    ) === JSON.stringify(['recently-edited-case', 'old-source-new-case', 'new-source-old-case']),
    '案例应按最近整理或收录时间倒序排列',
  )
}

export function testTradeViewGroupsByMonthAndLimitsVisibleTags(): void {
  const julyEarly = { ...trade, id: 'jul-1', openedAt: '2026-07-02T08:00:00.000Z' }
  const julyLate = { ...trade, id: 'jul-2', openedAt: '2026-07-18T08:00:00.000Z' }
  const june = { ...trade, id: 'jun-1', openedAt: '2026-06-30T08:00:00.000Z' }
  const groups = groupTradesByMonth([june, julyEarly, julyLate])

  assert(
    JSON.stringify(groups.map((group) => group.key)) === JSON.stringify(['2026-07', '2026-06']),
    '交易月份应按最近月份倒序排列',
  )
  assert(groups[0].items[0].id === 'jul-2', '同月交易应按交易日期倒序排列')

  const tags = getVisibleTradeTags({ ...trade, tags: ['A', 'B', 'C'] }, 2)
  assert(JSON.stringify(tags.visible) === JSON.stringify(['A', 'B']), '最多展示指定数量标签')
  assert(JSON.stringify(tags.hidden) === JSON.stringify(['C']), '应返回折叠标签供悬停提示使用')
  assert(tags.hiddenCount === 1, '应返回隐藏标签数量')

  const londonSession = getTradeSessionMeta({
    ...trade,
    tags: ['MTF ORA', 'London Open', 'LTF ChoCh'],
  })
  assert(londonSession?.label === '伦敦开盘', '旧交易应从标签中识别伦敦开盘时段')
  assert(londonSession?.kind === 'london', '伦敦时段应返回稳定的视觉类型')

  const promoted = promoteTradeSession({
    ...trade,
    session: undefined,
    tags: ['London Open', 'MTF ORA'],
  })
  assert(promoted.session === 'London Open', '标签中的时段应提升为独立 session 字段')
  assert(getSessionSelectValue(promoted) === 'London Open', '下拉应能选中已提升的时段')
  assert(normalizeSession('伦敦开盘') === 'London Open', '中文标签应规范为预设值')
  assert(normalizeSession('') === undefined, '空时段表示未设置')

  const metaPromoted = promoteTradeNotionMeta({
    ...trade,
    note: '<p><strong>市场叙事</strong>: Bullish</p>\n<p><strong>心理状态</strong>: Neutral</p>\n<p>真实笔记</p>',
  })
  assert(metaPromoted.psychology === 'Neutral', '正文心理状态应提升为属性')
  assert(metaPromoted.narrative === 'Bullish', '正文市场叙事应提升为属性')
  assert(!metaPromoted.note.includes('心理状态'), '提升后正文不应再保留心理状态')
  assert(!metaPromoted.note.includes('市场叙事'), '提升后正文不应再保留市场叙事')
  assert(metaPromoted.note.includes('真实笔记'), '提升后应保留真实笔记内容')
  assert(normalizePsychology('中性') === 'Neutral', '中文心理状态应规范为预设值')

  const filtered = filterTradesByFacets(
    [
      { ...trade, id: 'long', symbol: 'BTCUSDT', side: 'long', tags: ['ORA'] },
      { ...trade, id: 'short', symbol: 'ETHUSDT', side: 'short', tags: ['CHOCH'] },
    ],
    { symbol: 'ETHUSDT', side: 'short', tag: 'CHOCH' },
  )
  assert(filtered.length === 1 && filtered[0].id === 'short', '组合筛选应同时匹配品种、方向和标签')

  const sessionFiltered = filterTradesByFacets(
    [
      { ...trade, id: 'london', tags: ['London Open'] },
      { ...trade, id: 'asia', tags: ['Asia'] },
    ],
    { session: 'london' },
  )
  assert(sessionFiltered.length === 1 && sessionFiltered[0].id === 'london', '时段筛选应匹配规范化时段')

  const groupsWithInvalid = groupTradesByMonth([
    { ...trade, id: 'invalid', openedAt: 'not-a-date' },
    julyEarly,
  ])
  assert(
    groupsWithInvalid[groupsWithInvalid.length - 1]?.key === 'unknown',
    '未知日期分组必须排在有效月份之后',
  )

  const sortedWithInvalid = sortTradesByOpenedAtDesc([
    { ...trade, id: 'invalid', openedAt: 'not-a-date' },
    julyEarly,
    julyLate,
  ])
  assert(
    JSON.stringify(sortedWithInvalid.map((item) => item.id)) ===
      JSON.stringify(['jul-2', 'jul-1', 'invalid']),
    '日期倒序必须稳定地把未知日期放在最后',
  )

  const selected = intersectSelectedTradeIds(new Set(['visible', 'hidden']), [
    { ...trade, id: 'visible' },
  ])
  assert(selected.size === 1 && selected.has('visible'), '筛选后选择集合只能保留可见交易')

  const target = routeWithSearch('/period/this-month', '?symbol=BTCUSDT&side=long')
  assert(target.pathname === '/period/this-month', '路由目标 pathname 应正确')
  assert(target.search === '?symbol=BTCUSDT&side=long', '跨路由切换必须保留组合筛选查询')
}

export function testWorkbenchModePreservedWhenSwitchingQuickViews(): void {
  assert(pathWithWorkbenchMode('/period/this-week', 'board') === '/period/this-week/board', '看板下本周应落在 board 路由')
  assert(pathWithWorkbenchMode('/list', 'board') === '/board', '全部在看板形态应为 /board')
  assert(pathWithWorkbenchMode('/list', 'table') === '/table', '全部在表格形态应为 /table')
  assert(pathWithWorkbenchMode('/review-cases/mistakes', 'table') === '/review-cases/mistakes/table', '案例错题表格路径应保留 table')
  assert(workbenchModeFromPathname('/period/this-week/board') === 'board', '应从路径识别看板形态')
  assert(workbenchModeFromPathname('/strategy/%E5%AF%BC%E8%88%AA3/board') === 'board', '中文策略的编码路径应识别为看板形态')
  assert(workbenchModeFromPathname('/strategy/%E5%AF%BC%E8%88%AA3/table') === 'table', '中文策略的编码路径应识别为表格形态')
  assert(workbenchModeFromPathname('/table') === 'table', '应从路径识别表格形态')
  assert(workbenchModeFromPathname('/period/this-week') === 'list', '无后缀应为列表形态')
}

export function testPopoverPositionStaysAnchoredInsideViewport(): void {
  assert(clampPopoverLeft(440, 480, 2048) === 440, '宽屏应保持与触发器左侧对齐')
  assert(clampPopoverLeft(440, 480, 900) === 412, '空间不足时应向左夹取到 8px 安全边距')
  assert(clampPopoverLeft(195, 359, 375) === 8, '窄屏弹层不得溢出视口右侧')
  assert(clampPopoverLeft(4, 359, 375) === 8, '窄屏弹层不得溢出视口左侧')
}

export function testTradeDetailReturnRemembersListView(): void {
  const fromState = resolveTradeDetailReturn({
    from: { pathname: '/list', search: '?status=loss&session=london' },
    listPath: '/list',
    listSearch: '',
    tradeKind: 'live',
  })
  assert(fromState.pathname === '/list', '优先使用详情路由 state 的 pathname')
  assert(
    fromState.search === '?status=loss&session=london',
    '优先使用详情路由 state 的自定义视图查询',
  )

  const fromContext = resolveTradeDetailReturn({
    listPath: '/review-cases/mistakes',
    listSearch: '?symbol=BTCUSDT',
    tradeKind: 'case',
  })
  assert(fromContext.pathname === '/review-cases/mistakes', '无 state 时回退到列表上下文路径')
  assert(fromContext.search === '?symbol=BTCUSDT', '无 state 时回退到列表上下文查询')

  const fallback = resolveTradeDetailReturn({ tradeKind: 'case' })
  assert(fallback.pathname === '/review-cases', '无上下文时案例详情回退到案例列表')
  assert(fallback.search === '', '无上下文时不应伪造查询参数')
}

export function testSymbolIconsResolveDefaultsAndOverrides(): void {
  assert(normalizeSymbol(' btc_usdt ') === 'BTCUSDT', '品种名应规范化为大写无分隔符')
  assert(detectSymbolMarket('BTCUSDT') === 'crypto', 'USDT 交易对应加密货币')
  assert(detectSymbolMarket('EURUSD') === 'forex', '六位货币对应外汇')
  assert(detectSymbolMarket('XAUUSD') === 'metal', 'XAU 对应贵金属')

  const btc = resolveSymbolIcon('BTCUSDT')
  assert(btc.type === 'glyph' && btc.glyph === '₿', 'BTC 默认使用比特币占位符')

  const xau = resolveSymbolIcon('XAUUSD')
  assert(xau.type === 'svg' && xau.svgId === 'gold-bar', '黄金默认使用金条 SVG')

  const custom = resolveSymbolIcon('BTCUSDT', {
    BTCUSDT: {
      presetId: null,
      customDataUrl: 'data:image/png;base64,abc',
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
  })
  assert(custom.type === 'image' && custom.src.startsWith('data:'), '自定义上传应覆盖默认图标')
}

export function testSymbolCatalogSyncsComposerAndSettings(): void {
  const catalog = normalizeSymbolCatalog(['xauusd', 'BTCUSDT', 'BTCUSDT', ''])
  assert(catalog[0] === 'XAUUSD', '目录应规范化并去重')
  assert(catalog.filter((item) => item === 'BTCUSDT').length === 1, '重复品种只保留一次')

  const options = collectSymbolOptions(catalog, ['SOLUSDT'], ['legacy'])
  assert(options.includes('SOLUSDT'), '交易中出现的品种应进入共用选项')
  assert(options.includes('LEGACY'), '编辑中的历史品种应进入共用选项')
  assert(options.includes('XAUUSD'), '设置目录中的品种应出现在新建下拉')

  const empty = normalizeSymbolCatalog([])
  assert(
    empty.length === DEFAULT_SYMBOL_CATALOG.length,
    '空目录应回退到默认品种，避免新建交易无选项',
  )
}

export function testNormalizeTimeframePresetsAndAliases(): void {
  assert(normalizeTimeframe('15m') === '15M', '分钟级别应大写')
  assert(normalizeTimeframe('h4') === '4H', 'H4 写法应规范为 4H')
  assert(normalizeTimeframe(' 1h ') === '1H', '应去除空格并大写')
  assert(normalizeTimeframe('') === undefined, '空值应视为未设置')
  assert(normalizeTimeframe('1D') === '1D', '日线预设应保持不变')
  assert(normalizeTimeframe('1 Hour') === '1H', 'Notion 英文小时应映射到 1H')
  assert(normalizeTimeframe('4 Hour') === '4H', 'Notion 4 Hour 应映射到 4H')
  assert(normalizeTimeframe('15 minutes') === '15M', 'Notion 英文分钟应映射到 15M')
  assert(normalizeTimeframe('5 minutes') === '5M', 'Notion 5 minutes 应映射到 5M')
  assert(normalizeTimeframe('1HOUR') === '1H', '已导入的 1HOUR 脏数据应纠正为 1H')
  assert(normalizeTimeframe('15MINUTES') === '15M', '已导入的 15MINUTES 脏数据应纠正为 15M')
  assert(normalizeTimeframe('15MIN') === '15M', '15MIN 缩写应映射到 15M')
  assert(normalizeTimeframe('4小时') === '4H', '中文小时应映射到 4H')
  assert(normalizeTimeframe('15分钟') === '15M', '中文分钟应映射到 15M')
  assert(resolveTimeframe('') === '4H', '未录入波段级别应默认 4H')
  assert(resolveTimeframe(undefined) === '4H', '缺失波段级别应默认 4H')
  assert(resolveTimeframe('15M') === '15M', '已录入级别应保留')
  assert(getTimeframeTone('1 Hour') === 'hour', 'Notion 小时级别应使用小时色调')
  assert(getTimeframeTone('15 minutes') === 'minute', 'Notion 分钟级别应使用分钟色调')
}

export function testSavedTradeViewsNormalizeMatchAndMerge(): void {
  const base = {
    id: 'view-1',
    name: ' 本月伦敦盘 ',
    pathname: '/period/this-month/board',
    search: { session: 'london', empty: '' },
    pinned: true,
    order: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
  const normalized = normalizeSavedTradeViews([base, { ...base, id: '', name: '' }, null])
  assert(normalized.length === 1, '应过滤无效快捷视图')
  assert(normalized[0]?.name === '本月伦敦盘', '应清理快捷视图名称')
  assert(normalized[0]?.pathname === '/period/this-month', '应移除视图模式后缀')
  assert(
    savedViewMatchesLocation(
      { ...normalized[0]!, pathname: '/list' },
      '/board',
      '?session=london',
    ),
    '主交易列表、看板和表格应归一为同一路径',
  )
  assert(normalized[0]?.search.empty === undefined, '应移除空查询条件')
  assert(
    savedViewMatchesLocation(normalized[0]!, '/period/this-month/table', '?session=london'),
    '列表、看板和表格应匹配同一保存视图',
  )

  const merged = mergeSavedTradeViews(normalized, [
    { ...normalized[0]!, name: '新版名称', updatedAt: '2026-07-02T00:00:00.000Z' },
  ])
  assert(merged[0]?.name === '新版名称', '备份合并应保留较新的视图')
  assert(
    suggestSavedViewName('/period/this-month', new URLSearchParams('status=loss&session=london')) ===
      '本月 · 亏损 · 伦敦盘',
    '应根据当前条件生成清晰的建议名称',
  )
}

const strategy: Strategy = {
  id: 'breakout',
  name: 'Breakout',
  icon: 'trending-up',
  color: '#5e6ad2',
}

const trade: Trade = {
  id: 't-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'planned',
  conviction: 'medium',
  strategyId: strategy.id,
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'live',
  entry: 0,
  exit: null,
  stopLoss: null,
  size: 0,
  pnl: 0,
  rMultiple: 0,
  openedAt: '2026-06-01',
  closedAt: null,
  note: '',
}

function preview(rowIndex: number, errors: string[] = [], sourceId?: string): NotionTradePreview {
  return {
    rowIndex,
    sourceId,
    trade: {
      symbol: `SYM${rowIndex}`,
      side: 'long',
      status: 'planned',
      conviction: 'medium',
      strategyId: strategy.id,
      openedAt: '2026-06-01',
      tags: [],
      mistakeTags: [],
      entry: 0,
      pnl: 0,
      rMultiple: 0,
    },
    collectedTags: [],
    mistakeTags: [],
    noteHtml: '',
    images: [],
    imageCount: 0,
    errors,
    warnings: [],
  }
}

function image(name: string): ImageFile {
  return {
    zipPath: name,
    name,
    data: new Uint8Array(),
    mime: 'image/png',
    size: 0,
  }
}

export function testMergeImportPayloadKeepsPresetData(): void {
  const importedTrade: Trade = {
    ...trade,
    id: 'import-with-tags',
    tags: ['交易标签'],
    mistakeTags: ['追单'],
  }
  const merged = mergeImportPayload(
    {
      trades: [],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['本地标签'],
      mistakeTagPresets: ['本地错误'],
    },
    {
      version: 5,
      trades: [importedTrade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['导入标签'],
      mistakeTagPresets: ['导入错误'],
    },
  )

  assert(merged.tagPresets?.includes('导入标签'), 'imports tag presets')
  assert(merged.mistakeTagPresets?.includes('导入错误'), 'imports mistake tag presets')
  assert(merged.tagPresets?.includes('本地标签'), 'keeps local tag presets')
  assert(merged.tagPresets?.includes('交易标签'), 'harvests tags from imported trades into presets')
  assert(
    merged.mistakeTagPresets?.includes('追单'),
    'harvests mistake tags from imported trades into presets',
  )
  assert(merged.trades.some((t) => t.id === importedTrade.id), 'imports trades into state')
}

export function testMergeTagPresetsDedupesAndSorts(): void {
  const merged = mergeTagPresets([' 突破 ', '趋势'], ['突破', '', '假突破'], ['趋势'])
  assert(merged.length === 3, '标签预设应去重、去空')
  assert(merged.includes('突破') && merged.includes('趋势') && merged.includes('假突破'), '应保留全部有效标签')
  assert(merged[0] === [...merged].sort((a, b) => a.localeCompare(b, 'zh-CN'))[0], '应按中文排序')
  assert(collectTagOptions(['预设A'], [{ ...trade, tags: ['交易B'] }]).includes('预设A'), '选项应包含预设')
  assert(collectTagOptions(['预设A'], [{ ...trade, tags: ['交易B'] }]).includes('交易B'), '选项应包含交易标签')
}

export function testNotionImportUsesSameValidPreviewListForTradesAndImages(): void {
  const previews = [preview(0, ['bad row']), preview(1), preview(2)]
  const validPreviews = getImportableNotionPreviews(previews)
  const result = executeNotionImport(previews, [strategy], [])

  assert(result.trades.length === 2, 'invalid preview rows are not imported')
  assert(validPreviews[0]?.rowIndex === 1, 'first imported trade maps to first valid preview')
  assert(validPreviews[1]?.rowIndex === 2, 'second imported trade maps to second valid preview')
}

export function testReviewCaseTradeKindIsPreservedAndExcludedFromAccountTrades(): void {
  const reviewCase = { ...trade, id: 'case-trade', tradeKind: 'case' as Trade['tradeKind'] }

  assert(normalizeTradeKind('case') === 'case', 'case trade kind is preserved')
  assert(isReviewCaseTrade(reviewCase), 'case trade is recognized as review case')
  assert(!isAccountTrade(reviewCase), 'case trade is excluded from account trades')
  assert(isAccountTrade(trade), 'live trade remains an account trade')
}

export function testImportJsonAcceptsReviewCaseTrades(): void {
  const payload = {
    version: 5,
    trades: [{ ...trade, id: 'case-import', tradeKind: 'case' }],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }

  const result = parseImportJson(JSON.stringify(payload))

  assert(result.ok, 'import accepts review case trade kind')
}

export function testDefaultSmartTradeFiltersExcludeReviewCases(): void {
  const paperTrade: Trade = { ...trade, id: 'paper-trade', tradeKind: 'paper' }
  const reviewCase: Trade = { ...trade, id: 'review-case', tradeKind: 'case' }

  const starred = filterTrades(
    [trade, paperTrade, reviewCase],
    { type: 'starred' },
    [trade.id, paperTrade.id, reviewCase.id],
  )
  const casesOnly = filterTrades(
    [trade, paperTrade, reviewCase],
    { type: 'all', tradeKind: 'case' },
    [],
  )

  assert(starred.some((t) => t.id === trade.id), 'starred keeps live trades')
  assert(starred.some((t) => t.id === paperTrade.id), 'starred keeps paper trades')
  assert(!starred.some((t) => t.id === reviewCase.id), 'starred excludes review cases')
  assert(casesOnly.length === 1 && casesOnly[0]?.id === reviewCase.id, 'case view only shows cases')
}

export function testHideClosedDisplayPrefDoesNotHideReviewCases(): void {
  const closedLive: Trade = { ...trade, id: 'closed-live', status: 'win', tradeKind: 'live' }
  const closedCase: Trade = {
    ...trade,
    id: 'closed-case',
    status: 'loss',
    tradeKind: 'case',
    reviewCategory: 'mistake',
  }
  const openCase: Trade = {
    ...trade,
    id: 'open-case',
    status: 'planned',
    tradeKind: 'case',
  }

  const liveHidden = applyDisplayPrefs(
    [closedLive],
    { ...DEFAULT_DISPLAY, hideClosed: true },
    { type: 'all', tradeKind: 'live' },
  )
  const casesVisible = applyDisplayPrefs(
    [closedCase, openCase],
    { ...DEFAULT_DISPLAY, hideClosed: true },
    { type: 'all', tradeKind: 'case' },
  )

  assert(liveHidden.length === 0, '交易日志隐藏已平仓仍生效')
  assert(
    casesVisible.length === 2 &&
      casesVisible.some((item) => item.id === 'closed-case') &&
      casesVisible.some((item) => item.id === 'open-case'),
    '案例记录不受隐藏已平仓影响，侧栏有数时列表应能看见',
  )
}

export function testStatusFacetOverridesHideClosed(): void {
  const lossTrade: Trade = { ...trade, id: 'loss-trade', status: 'loss' }
  const openTrade: Trade = { ...trade, id: 'open-trade', status: 'open' }
  const hideClosedPrefs = { ...DEFAULT_DISPLAY, hideClosed: true }

  const withoutOverride = filterTradesByFacets(
    applyDisplayPrefs([lossTrade, openTrade], hideClosedPrefs, { type: 'all', tradeKind: 'live' }),
    { status: 'loss' },
  )
  assert(withoutOverride.length === 0, '先隐藏已平仓再筛亏损会得到空结果（旧行为）')

  const prefs =
    isHiddenWhenClosedFilter('loss')
      ? { ...hideClosedPrefs, hideClosed: false }
      : hideClosedPrefs
  const withOverride = filterTradesByFacets(
    applyDisplayPrefs([lossTrade, openTrade], prefs, { type: 'all', tradeKind: 'live' }),
    { status: 'loss' },
  )
  assert(
    withOverride.length === 1 && withOverride[0]?.id === 'loss-trade',
    '显式筛选亏损/盈利等已平仓状态时，应绕过隐藏已平仓',
  )
}

export function testReviewCaseScopesFilterCaseRecords(): void {
  const focusCase: Trade = {
    ...trade,
    id: 'focus-case',
    tradeKind: 'case',
    reviewStatus: 'focus',
    reviewCategory: 'focus',
  }
  const mistakeCase: Trade = {
    ...trade,
    id: 'mistake-case',
    tradeKind: 'case',
    reviewCategory: 'mistake',
    mistakeTags: ['追单'],
  }
  const reviewedCase: Trade = {
    ...trade,
    id: 'reviewed-case',
    tradeKind: 'case',
    reviewStatus: 'reviewed',
    reviewCategory: 'mastered',
  }
  const unreviewedCase: Trade = {
    ...trade,
    id: 'unreviewed-case',
    tradeKind: 'case',
    reviewStatus: 'unreviewed',
    reviewCategory: 'recheck',
  }

  const focus = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'focus' },
    [],
  )
  const mistakes = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'mistakes' },
    [],
  )
  const reviewed = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'reviewed' },
    [],
  )
  const unreviewed = filterTrades(
    [focusCase, mistakeCase, reviewedCase, unreviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'unreviewed' },
    [],
  )
  const all = filterTrades(
    [focusCase, mistakeCase, reviewedCase, unreviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    [],
  )

  assert(focus.length === 1 && focus[0]?.id === focusCase.id, 'focus scope only keeps focus cases')
  assert(mistakes.length === 1 && mistakes[0]?.id === mistakeCase.id, 'mistakes scope only keeps mistake cases')
  assert(reviewed.length === 1 && reviewed[0]?.id === reviewedCase.id, 'reviewed scope only keeps reviewed cases')
  assert(
    unreviewed.length === 2 &&
      unreviewed.some((item) => item.id === mistakeCase.id) &&
      unreviewed.some((item) => item.id === unreviewedCase.id),
    'unreviewed scope keeps explicitly recheck and still-unreviewed cases',
  )
  assert(all.length === 4, 'all scope keeps every review case')
}

export function testStrategyStatsExcludeReviewCasesByDefault(): void {
  const closedLive: Trade = {
    ...trade,
    id: 'live-win',
    status: 'win',
    pnl: 100,
    rMultiple: 2,
    closedAt: '2026-06-02',
  }
  const reviewCase: Trade = {
    ...closedLive,
    id: 'case-win',
    tradeKind: 'case',
    pnl: 10000,
    rMultiple: 100,
  }

  const stats = computeStrategyStats([closedLive, reviewCase], strategy.id)

  assert(stats.tradeCount === 1, 'strategy trade count excludes review cases')
  assert(stats.totalPnl === 100, 'strategy pnl excludes review cases')
  assert(stats.totalR === 2, 'strategy R excludes review cases')
}

export function testBuildReviewCaseFromTradeCopiesReviewFieldsWithoutMutatingSource(): void {
  const source: Trade = {
    ...trade,
    id: 'source-trade',
    ref: 'TRD-9',
    tags: ['好形态'],
    mistakeTags: ['追单'],
    timeframe: '15M',
    note: '<p>原始复盘</p>',
    deletedAt: '2026-06-01T00:00:00.000Z',
  }

  const copy = buildReviewCaseFromTrade(source, { id: 'case-copy', ref: 'CAS-2' })

  assert(copy.id === 'case-copy', 'copy gets a new id')
  assert(copy.ref === 'CAS-2', 'copy gets a case ref')
  assert(copy.tradeKind === 'case', 'copy is a review case')
  assert(copy.symbol === source.symbol, 'copy keeps symbol')
  assert(copy.strategyId === source.strategyId, 'copy keeps strategy')
  assert(copy.timeframe === source.timeframe, 'copy keeps timeframe')
  assert(copy.tags.includes('好形态'), 'copy keeps tags')
  assert(copy.mistakeTags.includes('追单'), 'copy keeps mistake tags')
  assert(copy.note.includes('来源交易：TRD-9'), 'copy records source trade')
  assert(copy.note.includes('原始复盘'), 'copy keeps note content')
  assert(!copy.deletedAt, 'copy is not deleted')
  assert(source.tradeKind === 'live', 'source trade kind is unchanged')
  assert(source.deletedAt === '2026-06-01T00:00:00.000Z', 'source deletion metadata is unchanged')
}

export function testGetNextReviewCaseRefUsesExistingCaseRefsOnly(): void {
  const next = getNextReviewCaseRef([
    { ...trade, ref: 'TRD-99' },
    { ...trade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    { ...trade, id: 'case-7', ref: 'CAS-7', tradeKind: 'case' },
  ])

  assert(next === 'CAS-8', 'next review case ref increments highest case ref')
}

export function testTradeTableRowFormatsDenseRecordFields(): void {
  const row = buildTradeTableRow(
    {
      ...trade,
      ref: 'TRD-42',
      symbol: 'BTCUSDT',
      status: 'win',
      side: 'long',
      timeframe: '4H',
      pnl: 260,
      rMultiple: 2.4,
      tags: ['MTF ORA', 'LTF ChoCh'],
      mistakeTags: ['追单'],
      openedAt: '2026-07-03',
    },
    [strategy],
  )

  assert(row.ref === 'TRD-42', 'table row keeps ref')
  assert(row.date === '2026/07/03', 'table row formats date compactly')
  assert(row.symbol === 'BTCUSDT', 'table row keeps symbol')
  assert(row.timeframe === '4H', 'table row exposes timeframe')
  assert(row.model === 'Breakout', 'table row resolves strategy name')
  assert(row.position === 'Buy', 'table row maps long to Buy')
  assert(row.status === 'Closed by T/P', 'table row maps winning status to close reason')
  assert(row.pnl === 'US$260.00', 'table row formats positive pnl')
  assert(row.rMultiple === '2.4', 'table row formats R multiple')
  assert(row.result === 'Profit', 'table row maps winning trade to Profit result')
  assert(row.confluences.join(',') === 'MTF ORA,LTF ChoCh', 'table row exposes tags as confluences')
  assert(row.mistakes.join(',') === '追单', 'table row exposes mistake tags')
}

export function testNotionCsvFallbackMatchesImagesByNotionIdNotFolderOrder(): void {
  const previews = [
    { ...preview(0, [], '1'), trade: { ...preview(0).trade, symbol: 'BTCUSDT' } },
    { ...preview(1, [], '2'), trade: { ...preview(1).trade, symbol: 'EURUSD' } },
  ]
  const attached = attachImagesToPreviewsBySourceId(previews, [
    { sourceId: '2', images: [image('eur.png')] },
    { sourceId: '1', images: [image('btc.png')] },
  ])

  assert(attached[0]?.trade.symbol === 'BTCUSDT', 'keeps BTC preview first')
  assert(attached[0]?.images[0]?.name === 'btc.png', 'BTC gets images with ID 1')
  assert(attached[1]?.trade.symbol === 'EURUSD', 'keeps EUR preview second')
  assert(attached[1]?.images[0]?.name === 'eur.png', 'EUR gets images with ID 2')
}

export async function testSampleNotionZipKeepsImagesAttachedToTrades(): Promise<void> {
  const fs = await import('node:fs/promises')
  const zip = await fs.readFile('Notion/ExportBlock-53a72011-14a6-46a0-8a93-5b5cdc4301a7-Part-1.zip')
  const result = await parseNotionZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), [
    strategy,
  ])
  const withImages = result.previews.filter((p) => p.imageCount > 0)

  assert(result.previews.length >= 3, 'sample Notion zip produces trade previews')
  assert(withImages.length >= 3, 'sample Notion zip keeps images attached to trades')
  assert(
    withImages.every((p) => p.trade.symbol),
    'image-bearing previews still have symbols',
  )
}

export async function testNotionZipUnwrapsNestedExportBlockWrapper(): Promise<void> {
  const fs = await import('node:fs/promises')
  const JSZip = (await import('jszip')).default
  const inner = await fs.readFile('Notion/ExportBlock-53a72011-14a6-46a0-8a93-5b5cdc4301a7-Part-1.zip')
  const outer = new JSZip()
  outer.file(
    'af09a22c-f4e3-451f-b5fe-eb0c5e2c41b0_ExportBlock-bee829d0-769d-410f-8e6b-b036b53a8567-Part-1.zip',
    inner,
  )
  const wrapped = await outer.generateAsync({ type: 'arraybuffer' })
  const result = await parseNotionZip(wrapped, [strategy])
  const withImages = result.previews.filter((preview) => preview.imageCount > 0)

  assert(result.previews.length >= 3, 'nested ExportBlock wrapper still produces trade previews')
  assert(withImages.length >= 3, 'nested ExportBlock wrapper still attaches images')
}

export function testNotionMultiSelectTagsStripEveryEmbeddedUrl(): void {
  const csv = [
    'Trade,Date,Symbol,Model,Session,Time Frame,Confluences,Entry Signal,Position,Status,S/L Pips,Net PnL,Max R/R,Weight,Profit/Loss,Mistakes',
    'Trade #,2026/06/28,BTCUSDT,导航1,London Open,15 minutes,MTF ORA,LTF ChoCh,Buy,Closed by T/P,100,US$20.00,2,A,🟢 Profit,"技术分析错误 (https://app.notion.com/p/a?pvs=21), 情绪化交易 (https://app.notion.com/p/b?pvs=21)"',
  ].join('\n')

  const result = parseNotionCsv(csv, [strategy])
  const tags = result.previews[0]?.mistakeTags ?? []

  assert(tags.includes('技术分析错误'), 'keeps first mistake tag text')
  assert(tags.includes('情绪化交易'), 'keeps second mistake tag text')
  assert(!tags.some((tag) => tag.includes('http')), 'removes embedded Notion URLs')
  assert(result.previews[0]?.trade.session === 'London Open', 'preserves session as structured trade data')
}

export function testNotionPsychologyAndNarrativeBecomeTradeProperties(): void {
  const csv = [
    'Date,Symbol,Position,Status,Narrative,Psychology,Net PnL',
    '2026/06/27,EURUSD,Buy,Closed by S/L,Bullish,Neutral,US$0',
  ].join('\n')
  const result = parseNotionCsv(csv, [strategy])
  const preview = result.previews[0]

  assert(preview?.trade.psychology === 'Neutral', '心理状态应写入 Trade.psychology')
  assert(preview?.trade.narrative === 'Bullish', '市场叙事应写入 Trade.narrative')
  assert(!preview?.noteHtml.includes('心理状态'), '心理状态不得再写入正文')
  assert(!preview?.noteHtml.includes('市场叙事'), '市场叙事不得再写入正文')
}

export function testNotionMarkdownBodyBecomesNoteHtml(): void {
  const md = [
    '# Trade #',
    'ID: 42',
    'Date: 2026/06/27',
    'Symbol: BTCUSDT',
    'Position: Buy',
    'Status: Closed by T/P',
    'Narrative: Bullish',
    'Psychology: Neutral',
    '',
    '## 复盘',
    '',
    '结构突破后继续持有，**不要追单**。',
    '',
    '- 入场理由充分',
    '- 出场偏早',
    '',
    '![chart](Trade%20#/image.png)',
    '',
    '下次注意节奏。',
    '',
    '![follow-up](Trade%20#/image%201.png)',
  ].join('\n')

  const parsed = parseNotionMd(md)
  assert(parsed.frontmatter.symbol?.includes('BTCUSDT') ?? false, 'frontmatter 仍应解析')
  assert(parsed.images.length === 2, '正文图片引用应单独收集')
  assert(parsed.bodyMarkdown.includes('结构突破后继续持有'), '正文文字不得丢弃')
  assert(parsed.bodyMarkdown.includes('![chart](Trade%20#/image.png)'), '正文应保留图片行以维持顺序')

  const html = notionBodyMarkdownToHtml(parsed.bodyMarkdown)
  assert(html.includes('<h2>复盘</h2>'), '标题应转为 HTML')
  assert(html.includes('<strong>不要追单</strong>'), '粗体应转为 HTML')
  assert(html.includes('<li>入场理由充分</li>'), '列表应转为 HTML')
  assert(html.includes('下次注意节奏'), '段落文字应保留')
  assert(html.includes('data-notion-img="0"'), '首图应保留为占位')
  assert(html.includes('data-notion-img="1"'), '次图应保留为占位')

  const firstText = html.indexOf('结构突破')
  const firstImg = html.indexOf('data-notion-img="0"')
  const midText = html.indexOf('下次注意节奏')
  const secondImg = html.indexOf('data-notion-img="1"')
  assert(firstText >= 0 && firstImg > firstText, '第一段文字应在第一张图之前')
  assert(midText > firstImg && secondImg > midText, '图文交错顺序应与 Notion 原文一致')

  const applied = applyNotionImageAssetsToNote(html, ['asset-a', 'asset-b'])
  assert(applied.includes('journal-asset://asset-a'), '占位应替换为首张资源')
  assert(applied.includes('journal-asset://asset-b'), '占位应替换为次张资源')
  assert(!applied.includes('data-notion-img'), '替换后不应残留占位')
  assert(
    applied.indexOf('journal-asset://asset-a') < applied.indexOf('下次注意节奏') &&
      applied.indexOf('下次注意节奏') < applied.indexOf('journal-asset://asset-b'),
    '替换后仍应保持图文交错顺序',
  )
}

export async function testCleanExpiredTradeTrashPurgesExpiredTradesOnly(): Promise<void> {
  const expired: Trade = {
    ...trade,
    id: 'expired',
    deletedAt: '2026-05-01T00:00:00.000Z',
  }
  const recent: Trade = {
    ...trade,
    id: 'recent',
    deletedAt: new Date().toISOString(),
  }
  const purged: string[] = []

  const count = await cleanExpiredTradeTrash([expired, recent], (id) => {
    purged.push(id)
  })

  assert(count === 1, 'only expired deleted trades are cleaned')
  assert(purged.length === 1 && purged[0] === 'expired', 'purges the expired trade id')
}

export function testDisplayActivitiesSeparateVisibleCommentsFromSystemHistory(): void {
  const events: DisplayActivityEvent[] = [
    { id: 'create', kind: 'create', timestamp: '2026-07-01T00:00:00.000Z' },
    { id: 'comment', kind: 'comment', commentId: 'comment', text: '等待确认', timestamp: '2026-07-02T00:00:00.000Z' },
    { id: 'note', kind: 'note', timestamp: '2026-07-03T00:00:00.000Z' },
  ]
  const result = partitionDisplayActivities(events)

  assert(result.comments.map((event) => event.id).join(',') === 'comment', '评论应进入默认可见区域')
  assert(result.system.map((event) => event.id).join(',') === 'create,note', '系统活动应进入折叠区域并保持顺序')
}

export function testLightboxModeDoesNotEmitAnEditorUpdate(): void {
  const calls: Array<[boolean, boolean | undefined]> = []
  const editor = {
    setEditable(editable: boolean, emitUpdate?: boolean) {
      calls.push([editable, emitUpdate])
    },
  }

  syncEditorLightboxEditable(editor, true)
  syncEditorLightboxEditable(editor, false)

  assert(
    JSON.stringify(calls) === JSON.stringify([[false, false], [true, false]]),
    '灯箱开关只应切换编辑器可编辑性，不得发出文档更新事件',
  )
}
