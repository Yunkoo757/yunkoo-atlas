import type { Strategy } from '@/data/strategies'
import { getTradeRemainingDays, isTradeExpired, type Trade } from '@/data/trades'
import { DEFAULT_DISPLAY, filterTrades, applyDisplayPrefs } from '@/lib/tradeFilters'
import {
  buildExportPayloadFromState,
  mergeImportPayload,
  parseImportJson,
  resetEmptyLibraryIntoStore,
} from '@/lib/importExport'
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
import { formatYmd } from '@/lib/periods'
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
import { buildOrderedTradeIds } from '@/shortcuts/listNav'
import {
  getPersistSuspendDepth,
  resumePersist,
  suspendPersist,
} from '@/storage/persist'
import { migrateFromLocalStorageIfNeeded } from '@/storage/migrate'
import type { StorageAdapter } from '@/storage/adapter'
import type { PersistedSnapshot } from '@/storage/types'
import {
  clearNoteDraft,
  getNoteDraft,
  hasNoteDraft,
  noteDraftCountForTests,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'
import {
  registerTradeScrollTarget,
  requestScrollToTrade,
} from '@/lib/tradeScrollTargets'
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  DEFAULT_SIDEBAR_PINS,
  resolvePinnedSecondaryNav,
} from '@/lib/sidebarNav'
import {
  countSidebarRoute,
  countSidebarTarget,
  normalizeSidebarWorkspaceItems,
  reorderSidebarWorkspaceItem,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import {
  applyDisplayPrefs as applyWorkbenchDisplayPrefs,
  filterTrades as filterWorkbenchTrades,
  getWorkbenchVisibleTrades,
} from '@/lib/workbenchTrades'
import { resolveTradeDetailReturn, tradeDetailNavState } from '@/lib/tradeRoute'
import { detectSymbolMarket, normalizeSymbol, resolveSymbolIcon, collectSymbolOptions, normalizeSymbolCatalog, DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import { normalizeTimeframe, resolveTimeframe, getTimeframeTone } from '@/data/trades'
import { bindingKey, chordFromEvent } from '@/shortcuts/chords'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
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
  searchForWorkspaceViewTarget,
} from '@/lib/workspaceViews'
import { normalizeDisplay } from '@/lib/tradeFilters'
import {
  partitionDisplayActivities,
  type DisplayActivityEvent,
} from '@/lib/activities'
import { syncEditorLightboxEditable } from '@/editor/Editor'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import {
  parseTradeReturnAnchor,
  serializeTradeReturnAnchor,
} from '@/hooks/useTradeReturnAnchor'

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

export function testLegacySecondarySidebarMetadataSupportsWorkspaceMigration(): void {
  const routes = SECONDARY_NAV.map((item) => item.to)
  const expected = ['/active', '/favorites', '/missed', '/sim']
  assert(
    JSON.stringify(routes) === JSON.stringify(expected),
    `旧快捷导航迁移路由应为 ${expected.join(', ')}，实际为 ${routes.join(', ')}`,
  )
  assert(
    routes.every((route) => !route.startsWith('/period/') && !route.startsWith('/strategy/')),
    '旧快捷入口只用于迁移，不得混入时间和策略路由',
  )
  const paper = SECONDARY_NAV.find((item) => item.id === 'paper')
  assert(paper?.label === '模拟回测', 'paper 项侧栏文案应为「模拟回测」')
  assert(
    JSON.stringify(DEFAULT_SIDEBAR_PINS) === JSON.stringify(['active', 'favorites', 'missed', 'paper']),
    '默认 sidebarPins 应保留四项系统入口用于历史配置迁移',
  )
}

export function testReorderSidebarWorkspaceItemKeepsPlacementGroups(): void {
  const items = normalizeSidebarWorkspaceItems([
    { id: 'a', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'b', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 1 },
    { id: 'c', target: { kind: 'system', id: 'missed' }, placement: 'pinned', order: 2 },
    { id: 'd', target: { kind: 'system', id: 'paper' }, placement: 'overflow', order: 3 },
  ])
  const moved = reorderSidebarWorkspaceItem(items, 'a', 'c')
  assert(
    moved.filter((item) => item.placement === 'pinned').map((item) => item.id).join(',') === 'b,c,a',
    '常驻组内应能把第一项拖到第三项位置',
  )
  assert(
    moved.find((item) => item.id === 'd')?.placement === 'overflow',
    '重排常驻时不得改动更多组',
  )
  assert(
    reorderSidebarWorkspaceItem(items, 'a', 'd') === items,
    '跨 placement 拖放应被拒绝',
  )
}

export async function testDesktopSidebarConsumesUnifiedWorkspaceNavigationContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/Sidebar.tsx', 'utf8')
  const defaultSystemTargets = DEFAULT_DISPLAY.sidebarWorkspaceItems
    .filter((item) => item.target.kind === 'system')
    .map((item) => item.target.kind === 'system' ? item.target.id : '')

  assert(
    defaultSystemTargets.join(',') === 'active,favorites,missed,paper',
    '默认工作区配置应包含四个系统目标并保持迁移顺序',
  )
  assert(
    PRIMARY_NAV.map((item) => item.id).join(',') === 'today,trades,reviewCases,dashboard',
    '核心模块顺序必须保持今日、交易、案例、仪表盘',
  )

  const savedView = {
    id: 'saved-valid',
    name: '有效保存视图',
    pathname: '/list',
    search: { status: 'loss' },
    pinned: false,
    order: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
  const configured = normalizeSidebarWorkspaceItems([
    ...DEFAULT_DISPLAY.sidebarWorkspaceItems,
    { id: 'saved-valid', target: { kind: 'saved-view', viewId: savedView.id }, placement: 'pinned', order: 4 },
    { id: 'strategy-valid', target: { kind: 'strategy', strategyId: strategy.id }, placement: 'pinned', order: 5 },
    { id: 'case-focus', target: { kind: 'case-view', scope: 'focus' }, placement: 'pinned', order: 6 },
    { id: 'saved-invalid', target: { kind: 'saved-view', viewId: 'deleted' }, placement: 'pinned', order: 7 },
    { id: 'case-mistakes', target: { kind: 'case-view', scope: 'mistakes' }, placement: 'pinned', order: 8 },
  ] as SidebarWorkspaceItem[])
  const dailyItems = configured
    .filter((item) => item.placement === 'pinned')
    .map((item) => resolveSidebarWorkspaceItem(item, { savedViews: [savedView], strategies: [strategy] }))
    .filter((item) => !item.invalid)

  assert(dailyItems.length === 7, '日常列表应只保留前 8 个 pinned 中的有效项')
  assert(!dailyItems.some((item) => item.item.id === 'saved-invalid'), '失效项不得进入日常列表')
  assert(!dailyItems.some((item) => item.item.id === 'case-mistakes'), '第 9 个配置项不得进入 pinned 日常列表')
  assert(source.includes('data-sidebar-overflow'), 'Sidebar 应为 overflow 项渲染「更多」分区')
  assert(source.includes('sb-workspace-editor-backdrop'), 'Sidebar 管理器应支持点击外部关闭')
  assert(source.includes('state.display.sidebarWorkspaceItems'), 'Sidebar 应读取统一工作区配置')
  assert(source.includes('resolveSidebarWorkspaceItem'), 'Sidebar 应通过统一解析器准备日常项')
  assert(source.includes('resolveSidebarSelection'), 'Sidebar 应通过统一选择器保证唯一强选中态')
  assert(source.includes('countSidebarTarget'), 'Sidebar 应通过统一计数函数计算条目数量')
  assert(source.includes('reorderSidebarWorkspaceItem'), 'Sidebar 应支持工作区项自定义拖拽排序')
  assert(source.includes('onDragStart'), 'Sidebar 应拦截原生链接拖拽预览')
  assert(!source.includes('resolvePinnedSecondaryNav'), 'Sidebar 不得继续直接解析旧 sidebarPins')
}

export function testEmptyLibraryUsesApprovedDefaultProfile(): void {
  const previous = useStore.getState()
  const previousBindings = useShortcutStore.getState().bindings
  try {
    resetEmptyLibraryIntoStore()
    const state = useStore.getState()
    assert(
      state.strategies.map((strategy) => strategy.id).join(',') ===
        'navigation-1,navigation-2,navigation-3,navigation-4',
      '新建交易库应使用已确认的四个默认策略',
    )
    assert(
      state.tagPresets.join(',') === 'MTF ORA,no idm预期A,no idm预期B,LTF ChoCh,1m bos',
      '新建交易库应使用已确认的普通标签词库',
    )
    assert(
      state.mistakeTagPresets.join(',') ===
        '缺乏耐心,技术分析错误,仓位大小错误,修改止损,周末交易,过度分析,情绪化交易,受新闻影响',
      '新建交易库应使用已确认的错误与违规词库',
    )
    assert(
      state.display.groupByDate && !state.display.groupByStrategy && state.display.sortBy === 'date',
      '新建交易库应默认按月份分组并按日期排序',
    )
  } finally {
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      selectedId: previous.selectedId,
      composerOpen: previous.composerOpen,
      composerTrade: previous.composerTrade,
      closeTradeRequest: previous.closeTradeRequest,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      starredIds: previous.starredIds,
      subscribedIds: previous.subscribedIds,
      pinnedStrategyIds: previous.pinnedStrategyIds,
      tagPresets: previous.tagPresets,
      mistakeTagPresets: previous.mistakeTagPresets,
      display: previous.display,
      profile: previous.profile,
      savedTradeViews: previous.savedTradeViews,
      symbolIcons: previous.symbolIcons,
      symbolCatalog: previous.symbolCatalog,
    })
    useShortcutStore.getState().hydrateBindings(previousBindings)
  }
}

export function testApprovedShortcutDefaultsMatchProfile(): void {
  const expected: Record<string, string> = {
    'global.commandPalette': 'w',
    'global.newTrade': 'n',
    'global.newCase': 'shift+n',
    'global.undo': 'mod+z',
    'global.redo': 'mod+shift+z',
    'global.closeOverlay': 'escape',
    'nav.today': 'alt+t',
    'nav.active': 'alt+1',
    'nav.favorites': 'alt+2',
    'nav.missed': 'alt+3',
    'nav.sim': 'g',
    'nav.list': 'alt+w',
    'nav.reviewCases': 'alt+c',
    'nav.board': 'alt+5',
    'nav.dashboard': 'i',
    'nav.strategies': 'o',
    'view.list': 'l',
    'view.board': 'b',
    'view.table': 't',
    'trade.prev': 'q',
    'trade.next': 'e',
    'trade.backToList': 'escape',
    'list.focusNext': 'q',
    'list.focusPrev': 'e',
    'list.openFocused': 'enter',
    'list.selectAll': 'mod+a',
    'list.clearSelection': 'escape',
    'list.toggleFilters': 'f',
    'image.prev': 'w',
    'image.next': 's',
    'image.close': 'escape',
    'image.reset': 'alt+r',
  }
  assert(
    SHORTCUT_ACTIONS.length === Object.keys(expected).length,
    '默认配置应覆盖每一个可配置快捷键动作',
  )
  for (const action of SHORTCUT_ACTIONS) {
    assert(
      bindingKey(action.defaultBinding) === expected[action.id],
      `${action.label} 应使用已确认的默认快捷键 ${expected[action.id]}`,
    )
  }
}

export async function testFirstInstallSnapshotPersistsApprovedDefaultProfile(): Promise<void> {
  let saved: PersistedSnapshot | null = null
  const adapter: StorageAdapter = {
    open: async () => undefined,
    getManifest: async () => { throw new Error('本测试不读取 manifest') },
    loadSnapshot: async () => null,
    saveSnapshot: async (snapshot) => { saved = snapshot },
    saveAsset: async () => { throw new Error('空库不应写入附件') },
    getAssetObjectUrl: async () => null,
    getAssetForExport: async () => null,
    importAssets: async () => undefined,
  }

  const migrated = await migrateFromLocalStorageIfNeeded(adapter)
  assert(migrated, '首次安装应生成并保存初始快照')
  if (saved === null) throw new Error('首次安装应写入可读取的初始快照')
  const snapshot: PersistedSnapshot = saved
  assert(
    snapshot.strategies.map((strategy) => strategy.id).join(',') ===
      'navigation-1,navigation-2,navigation-3,navigation-4',
    '首次安装快照应固化默认策略',
  )
  assert(
    snapshot.tagPresets?.join(',') === 'MTF ORA,no idm预期A,no idm预期B,LTF ChoCh,1m bos',
    '首次安装快照应固化普通标签词库',
  )
  assert(
    snapshot.mistakeTagPresets?.length === 8,
    '首次安装快照应固化错误与违规词库',
  )
}

export async function testAppOptsIntoStableReactRouterFutureBehavior(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/App.tsx', 'utf8')

  assert(source.includes('v7_startTransition: true'), 'App 应启用 v7_startTransition')
  assert(source.includes('v7_relativeSplatPath: true'), 'App 应启用 v7_relativeSplatPath')
}

export async function testHeavyRoutesAreLoadedOnDemand(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/App.tsx', 'utf8')

  assert(source.includes("const Dashboard = lazy(() =>"), '仪表盘应按路由延迟加载')
  assert(source.includes("const DetailView = lazy(() =>"), '交易详情编辑器应按路由延迟加载')
  assert(source.includes("const StrategiesPanel = lazy(() =>"), '策略编辑器应按设置路由延迟加载')
  assert(source.includes('<Suspense'), '延迟路由必须提供加载反馈')

  const detailSource = await fs.readFile('src/views/DetailView.tsx', 'utf8')
  const editorSource = await fs.readFile('src/editor/Editor.tsx', 'utf8')
  const draftsSource = await fs.readFile('src/storage/noteDrafts.ts', 'utf8')
  for (const [name, moduleSource] of [
    ['DetailView', detailSource],
    ['Editor', editorSource],
    ['noteDrafts', draftsSource],
  ] as const) {
    assert(
      moduleSource.includes("from '@/storage/bootstrap'"),
      `${name} 应直接导入 storage/bootstrap，避免延迟分块循环依赖`,
    )
  }
}

export async function testDataSettingsMatchesDesktopBackupRetentionPolicy(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8')

  assert(source.includes('最多保留 20 份'), '数据设置应展示桌面端实际的 20 份备份上限')
  assert(!source.includes('最多保留 7 份'), '不得继续展示旧的 7 份备份上限')
}

export async function testTagSettingsExposeDistinctAccessibleControlNames(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/settings/TagPresetsPanel.tsx', 'utf8')

  for (const label of [
    'aria-label={`新增${title}`}',
    'aria-label={`添加${title}`}',
    'aria-label={`批量导入${title}`}',
    'aria-label={`导入${title}`}',
  ]) {
    assert(source.includes(label), `标签设置缺少可区分的无障碍名称：${label}`)
  }
}

export function testResolvePinnedSecondaryNavOrdersAndHidesEmpty(): void {
  const defaultItems = resolvePinnedSecondaryNav(DEFAULT_SIDEBAR_PINS)
  assert(
    defaultItems.map((item) => item.id).join(',') === 'active,favorites,missed,paper',
    '默认 pins 应按 SECONDARY_NAV 四项顺序解析',
  )
  assert(
    defaultItems.map((item) => item.to).join(',') === '/active,/favorites,/missed,/sim',
    '默认 pins 路由顺序错误',
  )

  const reordered = resolvePinnedSecondaryNav(['paper', 'active'])
  assert(
    reordered.map((item) => item.id).join(',') === 'paper,active',
    '应严格按 sidebarPins 顺序渲染',
  )

  assert(resolvePinnedSecondaryNav([]).length === 0, '空 pins 应得到空列表（侧栏隐藏整区）')
  assert(
    resolvePinnedSecondaryNav(['active', 'unknown' as never, 'missed']).map((item) => item.id).join(',') ===
      'active,missed',
    '未知 id 应被跳过',
  )
}

export function testNormalizeDisplayMigratesSidebarPinsInOriginalOrder(): void {
  const display = normalizeDisplay({ sidebarPins: ['missed', 'active', 'paper'] })

  assert(
    display.sidebarWorkspaceItems.map((item) =>
      item.target.kind === 'system' ? item.target.id : '',
    ).join(',') === 'missed,active,paper',
    '旧 sidebarPins 迁移后应保持原始顺序',
  )
}

export function testNormalizeDisplayPrefersExplicitWorkspaceItemsOverLegacyPins(): void {
  const display = normalizeDisplay({
    sidebarPins: ['missed', 'active'],
    sidebarWorkspaceItems: [
      { id: 'paper-first', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 0 },
    ],
  })

  assert(
    display.sidebarWorkspaceItems.length === 1 &&
      display.sidebarWorkspaceItems[0]?.target.kind === 'system' &&
      display.sidebarWorkspaceItems[0].target.id === 'paper',
    '显式 sidebarWorkspaceItems 应优先于旧 sidebarPins',
  )
}

export function testReplaceSidebarWorkspaceItemsNormalizesWithoutMutatingLegacyPins(): void {
  const original = useStore.getState().display
  const legacyPins = ['missed', 'active'] as typeof original.sidebarPins
  useStore.setState({ display: normalizeDisplay({ ...original, sidebarPins: legacyPins }) })

  try {
    useStore.getState().replaceSidebarWorkspaceItems([
      { id: 'paper', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 9 },
      { id: 'paper-copy', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 10 },
      { id: 'active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 11 },
    ])
    const display = useStore.getState().display
    assert(display.sidebarPins.join(',') === legacyPins.join(','), '替换工作区项目不得改写旧 sidebarPins')
    assert(display.sidebarWorkspaceItems.length === 2, '替换工作区项目应再次去重规范化')
    assert(display.sidebarWorkspaceItems.map((item) => item.order).join(',') === '0,1', '替换后 order 应连续规范化')
  } finally {
    useStore.setState({ display: original })
  }
}

export async function testSidebarWorkspaceSurvivesExportImportAndNormalizesInvalidData(): Promise<void> {
  const rawItems: SidebarWorkspaceItem[] = [
    { id: 'active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'saved-valid', target: { kind: 'saved-view', viewId: 'saved-valid' }, placement: 'pinned', order: 1 },
    { id: 'strategy-valid', target: { kind: 'strategy', strategyId: strategy.id }, placement: 'pinned', order: 2 },
    { id: 'case-focus', target: { kind: 'case-view', scope: 'focus' }, placement: 'pinned', order: 3 },
    { id: 'paper', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 4 },
    { id: 'missing-view', target: { kind: 'saved-view', viewId: 'deleted-view' }, placement: 'pinned', order: 5 },
    { id: 'missing-strategy', target: { kind: 'strategy', strategyId: 'deleted-strategy' }, placement: 'pinned', order: 6 },
    { id: 'case-reviewed', target: { kind: 'case-view', scope: 'reviewed' }, placement: 'pinned', order: 7 },
    { id: 'case-mistakes', target: { kind: 'case-view', scope: 'mistakes' }, placement: 'pinned', order: 8 },
    { id: 'saved-duplicate', target: { kind: 'saved-view', viewId: 'saved-valid' }, placement: 'overflow', order: 9 },
  ]
  const display = { ...DEFAULT_DISPLAY, sidebarWorkspaceItems: rawItems }
  const exported = await buildExportPayloadFromState({
    trades: [],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display,
    savedTradeViews: [],
  }, async () => null)
  const parsed = parseImportJson(JSON.stringify(exported))
  assert(parsed.ok, '导出的完整 display 应可重新导入')
  if (!parsed.ok) return

  const merged = mergeImportPayload({
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }, parsed.data)
  const items = merged.display.sidebarWorkspaceItems

  assert(items.length === 9, '重复目标应在导入边界去重且不丢失失效引用')
  assert(items.map((item) => item.id).join(',') === rawItems.slice(0, 9).map((item) => item.id).join(','), '导入应保留目标顺序')
  assert(items.filter((item) => item.placement === 'pinned').length === 8, '导入后最多保留 8 个 pinned')
  assert(items[8]?.placement === 'overflow', '第 9 个 pinned 应规范化为 overflow')
  assert(items.some((item) => item.id === 'missing-view'), '导入不得删除失效保存视图引用')
  assert(items.some((item) => item.id === 'missing-strategy'), '导入不得删除失效策略引用')
  const paper = resolveSidebarWorkspaceItem(items[4]!, { savedViews: [], strategies: [] })
  assert(paper.pathname === '/sim', '旧 paper 别名最终应解析到 /sim')
}

export function testMergeImportPayloadNormalizesCorruptedDisplay(): void {
  const corruptedItems = [
    { id: 'active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 99 },
    { id: 'active-copy', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 100 },
    { id: 'active', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 101 },
  ] as SidebarWorkspaceItem[]
  const merged = mergeImportPayload({
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }, {
    version: 6,
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY, sidebarWorkspaceItems: corruptedItems },
  })

  assert(merged.display.sidebarWorkspaceItems.length === 1, 'mergeImportPayload 应统一去重损坏的工作区项目')
  assert(merged.display.sidebarWorkspaceItems[0]?.order === 0, 'mergeImportPayload 应统一重写损坏的 order')
}

export function testNormalizeSidebarWorkspaceItemsDeduplicatesAndLimitsPinnedItems(): void {
  const items = normalizeSidebarWorkspaceItems([
    { id: 'active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'favorites', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 1 },
    { id: 'missed', target: { kind: 'system', id: 'missed' }, placement: 'pinned', order: 2 },
    { id: 'paper', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 3 },
    { id: 'saved-a', target: { kind: 'saved-view', viewId: 'view-a' }, placement: 'pinned', order: 4 },
    { id: 'strategy-a', target: { kind: 'strategy', strategyId: 'strategy-a' }, placement: 'pinned', order: 5 },
    { id: 'case-focus', target: { kind: 'case-view', scope: 'focus' }, placement: 'pinned', order: 6 },
    { id: 'case-mistakes', target: { kind: 'case-view', scope: 'mistakes' }, placement: 'pinned', order: 7 },
    { id: 'case-reviewed', target: { kind: 'case-view', scope: 'reviewed' }, placement: 'pinned', order: 8 },
    { id: 'saved-a-copy', target: { kind: 'saved-view', viewId: 'view-a' }, placement: 'pinned', order: 9 },
  ])

  assert(items.length === 9, '语义重复项应被删除')
  assert(items.filter((item) => item.placement === 'pinned').length === 8, '最多只能固定 8 项')
  assert(items[8]?.placement === 'overflow', '第 9 个固定项应进入 overflow')
  assert(items.map((item) => item.order).join(',') === '0,1,2,3,4,5,6,7,8', 'order 应连续重写')
}

export function testNormalizeSidebarWorkspaceItemsKeepsFirstDuplicateId(): void {
  const items = normalizeSidebarWorkspaceItems([
    { id: 'duplicate', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'duplicate', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 1 },
  ])

  assert(items.length === 1, '相同 id 的损坏导入项只能保留一个')
  assert(
    items[0]?.target.kind === 'system' && items[0].target.id === 'active',
    '相同 id 的损坏导入项应保留排序更早的项目',
  )
}

export function testSidebarWorkspaceResolvesEveryTargetKindAndKeepsInvalidReferences(): void {
  const savedView = {
    id: 'loss-view',
    name: '重命名后的亏损',
    pathname: '/list',
    search: { status: 'loss' },
    pinned: false,
    order: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  }
  const sources = { savedViews: [savedView], strategies: [strategy] }
  const items: SidebarWorkspaceItem[] = [
    { id: 'paper', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 0 },
    { id: 'saved', target: { kind: 'saved-view', viewId: savedView.id }, placement: 'pinned', order: 1 },
    { id: 'strategy', target: { kind: 'strategy', strategyId: strategy.id }, placement: 'pinned', order: 2 },
    { id: 'mistakes', target: { kind: 'case-view', scope: 'mistakes' }, placement: 'pinned', order: 3 },
  ]
  const [paper, saved, resolvedStrategy, mistakes] = items.map((item) =>
    resolveSidebarWorkspaceItem(item, sources),
  )

  assert(paper?.pathname === '/sim' && paper.icon === 'paper', 'paper 应解析为模拟回测目标 /sim')
  assert(saved?.label === '重命名后的亏损' && !saved.invalid, '保存视图应实时显示重命名后的名称')
  assert(resolvedStrategy?.label === strategy.name && !resolvedStrategy.invalid, '策略应解析当前名称')
  assert(
    mistakes?.pathname === '/review-cases/mistakes' && mistakes.icon === 'case-view',
    '案例错题应解析到固定案例路径',
  )

  const invalidSaved = resolveSidebarWorkspaceItem(items[1]!, { savedViews: [], strategies: [strategy] })
  const invalidStrategy = resolveSidebarWorkspaceItem(items[2]!, { savedViews: [savedView], strategies: [] })
  assert(invalidSaved.invalid, '删除保存视图后应保留引用并标记 invalid')
  assert(invalidStrategy.invalid, '删除策略后管理列表应保留引用并标记 invalid')
  assert(
    [invalidStrategy].filter((item) => !item.invalid).length === 0 && items.includes(items[2]!),
    '删除策略后日常列表可隐藏失效项，但管理列表仍保留原配置',
  )

  for (const alias of ['/sim', '/paper', '/practice']) {
    const selection = resolveSidebarSelection({ pathname: alias, search: '', items: [paper!] })
    assert(selection.activeWorkspaceItemId === 'paper', `${alias} 应激活 paper 工作区项`)
  }
}

export function testSidebarSelectionPrefersExactWorkspaceItemAndMarksModifiedFilters(): void {
  const savedView = {
    id: 'loss-view',
    name: '亏损 EURUSD',
    pathname: '/list',
    search: { status: 'loss', symbol: 'EURUSD' },
    pinned: false,
    order: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
  const sources = { savedViews: [savedView], strategies: [] }
  const saved = resolveSidebarWorkspaceItem(
    { id: 'saved-loss', target: { kind: 'saved-view', viewId: savedView.id }, placement: 'pinned', order: 0 },
    sources,
  )
  const active = resolveSidebarWorkspaceItem(
    { id: 'fixed-active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 1 },
    sources,
  )

  const exact = resolveSidebarSelection({
    pathname: '/table',
    search: '?symbol=EURUSD&status=loss',
    items: [active, saved],
  })
  assert(exact.activeWorkspaceItemId === 'saved-loss', '完整查询精确匹配时只应激活保存视图')
  assert(exact.activePrimaryId === undefined, '保存视图精确匹配时不应同时激活核心导航')
  assert(exact.modifiedWorkspaceItemId === undefined, '精确匹配不应标记 modified')

  const modified = resolveSidebarSelection({
    pathname: '/active/board',
    search: '?symbol=EURUSD',
    items: [active, saved],
  })
  assert(modified.activeWorkspaceItemId === 'fixed-active', '同一路径叠加查询仍应激活固定项')
  assert(modified.modifiedWorkspaceItemId === 'fixed-active', '额外查询应把固定项标记为 modified')

  const fallbacks = [
    ['/today-record', 'today'],
    ['/list', 'trades'],
    ['/review-cases/focus', 'reviewCases'],
    ['/dashboard', 'dashboard'],
  ] as const
  for (const [pathname, id] of fallbacks) {
    const selection = resolveSidebarSelection({ pathname, search: '', items: [active] })
    assert(selection.activePrimaryId === id, `${pathname} 应回退激活核心项 ${id}`)
  }
}

export function testSidebarTargetCountsMatchWorkbenchFiltering(): void {
  const trades: Trade[] = [
    { ...trade, id: 'open-live', status: 'open' },
    { ...trade, id: 'loss-live', status: 'loss' },
    { ...trade, id: 'paper-planned', tradeKind: 'paper' },
    {
      ...trade,
      id: 'mistake-case',
      tradeKind: 'case',
      reviewCategory: 'mistake',
      mistakeTags: ['追单'],
    },
    { ...trade, id: 'deleted-open', status: 'open', deletedAt: '2026-07-10T00:00:00.000Z' },
  ]
  const display = { ...DEFAULT_DISPLAY, hideClosed: true }
  const savedView = {
    id: 'loss-view',
    name: '亏损',
    pathname: '/list',
    search: { status: 'loss' },
    pinned: false,
    order: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
  const sources = { savedViews: [savedView], strategies: [strategy] }
  const context = { trades, starredIds: ['loss-live'], display }
  const cases = [
    {
      target: resolveSidebarWorkspaceItem(
        { id: 'active', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
        sources,
      ),
      filter: { type: 'active', tradeKind: 'live' } as const,
      search: '',
    },
    {
      target: resolveSidebarWorkspaceItem(
        { id: 'saved', target: { kind: 'saved-view', viewId: savedView.id }, placement: 'pinned', order: 1 },
        sources,
      ),
      filter: { type: 'all', tradeKind: 'live' } as const,
      search: '?status=loss',
    },
    {
      target: resolveSidebarWorkspaceItem(
        { id: 'strategy', target: { kind: 'strategy', strategyId: strategy.id }, placement: 'pinned', order: 2 },
        sources,
      ),
      filter: { type: 'strategy', strategyId: strategy.id } as const,
      search: '',
    },
    {
      target: resolveSidebarWorkspaceItem(
        { id: 'mistakes', target: { kind: 'case-view', scope: 'mistakes' }, placement: 'pinned', order: 3 },
        sources,
      ),
      filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'mistakes' } as const,
      search: '',
    },
  ]

  for (const entry of cases) {
    const pageCount = getWorkbenchVisibleTrades({
      ...context,
      filter: entry.filter,
      search: entry.search,
    }).length
    assert(
      countSidebarTarget(entry.target, context) === pageCount,
      `${entry.target.key} 的侧栏计数应与页面筛选一致`,
    )
  }
  assert(countSidebarTarget(cases[1]!.target, context) === 1, '显式亏损筛选应覆盖 hideClosed')
}

export function testCoreSidebarRouteCountsMatchRestoredWorkbenchFiltering(): void {
  const today = formatYmd(new Date())
  const trades: Trade[] = [
    { ...trade, id: 'today-open', status: 'open', openedAt: today },
    { ...trade, id: 'today-loss', status: 'loss', openedAt: today },
    { ...trade, id: 'older-open', status: 'open', openedAt: '2026-06-01' },
    {
      ...trade,
      id: 'focus-case',
      tradeKind: 'case',
      reviewCategory: 'focus',
      openedAt: '2026-06-01',
    },
  ]
  const display = { ...DEFAULT_DISPLAY, hideClosed: true }
  const context = { trades, starredIds: [], display }
  const cases = [
    {
      pathname: '/today-record/table',
      search: '',
      filter: { type: 'period', period: 'today', tradeKind: 'live' } as const,
    },
    {
      pathname: '/list/board',
      search: '',
      filter: { type: 'all', tradeKind: 'live' } as const,
    },
    {
      pathname: '/list/table',
      search: '?status=loss',
      filter: { type: 'all', tradeKind: 'live' } as const,
    },
    {
      pathname: '/review-cases/focus',
      search: '',
      filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'focus' } as const,
    },
  ]

  for (const entry of cases) {
    const pageCount = getWorkbenchVisibleTrades({
      ...context,
      filter: entry.filter,
      search: entry.search,
    }).length
    assert(
      countSidebarRoute(entry.pathname, entry.search, context) === pageCount,
      `${entry.pathname}${entry.search} 的核心侧栏计数应与恢复后的工作台一致`,
    )
  }
}

export function testTradeFiltersReexportTheWorkbenchRuleSourceWithoutBehaviorDrift(): void {
  assert(filterTrades === filterWorkbenchTrades, '路由筛选必须从 workbenchTrades 共享唯一实现')
  assert(
    applyDisplayPrefs === applyWorkbenchDisplayPrefs,
    '显示偏好筛选必须从 workbenchTrades 共享唯一实现',
  )

  const openLive: Trade = { ...trade, id: 'open-live', status: 'open' }
  const lossLive: Trade = { ...trade, id: 'loss-live', status: 'loss' }
  const openPaper: Trade = { ...trade, id: 'open-paper', status: 'open', tradeKind: 'paper' }
  const activeLive = filterTrades(
    [openLive, lossLive, openPaper],
    { type: 'active', tradeKind: 'live' },
    [],
  )
  assert(
    activeLive.length === 1 && activeLive[0]?.id === openLive.id,
    '共享路由筛选应保留 active + live 的既有语义',
  )

  const display = { ...DEFAULT_DISPLAY, hideClosed: true }
  assert(
    applyDisplayPrefs([openLive, lossLive], display, { type: 'all', tradeKind: 'live' }).length === 1,
    '兼容导出的显示偏好函数仍应隐藏终态交易',
  )
  const explicitLoss = getWorkbenchVisibleTrades({
    trades: [openLive, lossLive],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    display,
    search: '?status=loss',
  })
  assert(
    explicitLoss.length === 1 && explicitLoss[0]?.id === lossLive.id,
    '工作台显式终态查询仍应覆盖 hideClosed',
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
    getActiveWorkspaceView('trade', '/list', '?status=win') === undefined,
    '盈利筛选不得误选中「全部」',
  )
  assert(
    getActiveWorkspaceView('trade', '/list', '?status=win&symbol=EURUSD') === undefined,
    '自建盈利视图叠加临时条件时「全部」不得高亮',
  )
  assert(
    getActiveWorkspaceView('trade', '/list', '?symbol=EURUSD') === undefined,
    '存在任何筛选时「全部」都不得高亮',
  )
  assert(
    searchForWorkspaceViewTarget('?status=win&symbol=EURUSD', { id: 'all' }) === '',
    '从保存视图切回全部应清除所有筛选',
  )
  assert(
    searchForWorkspaceViewTarget('?status=win&symbol=EURUSD', {
      id: 'loss',
      search: '?status=loss',
    }) === '?symbol=EURUSD&status=loss',
    '盈利切到亏损应替换 status',
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
  assert(rememberableWorkspaceKind('/today-record') === 'today', '今日记录应记入今日工作区')
  assert(rememberableWorkspaceKind('/today-record/table') === 'today', '今日表格应记入今日工作区')
  assert(rememberableWorkspaceKind('/review-cases/mistakes') === 'case', '错题应记入案例工作区')

  const today = resolveWorkspaceNavTarget('today', {
    pathname: '/today-record/board',
    search: '?session=london',
  })
  assert(today.pathname === '/today-record/board', '今日工作区应还原上次视图形态')
  assert(today.search === '?session=london', '今日工作区应还原筛选条件')

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

  const deletedStrategy = resolveWorkspaceNavTarget(
    'trade',
    { pathname: '/strategy/deleted/board', search: '?status=win' },
    [strategy],
  )
  assert(deletedStrategy.pathname === '/list', '已删除策略的工作区记忆应回退到全部')

  const existingStrategy = resolveWorkspaceNavTarget(
    'trade',
    { pathname: `/strategy/${strategy.id}/table`, search: '?status=win' },
    [strategy],
  )
  assert(existingStrategy.pathname === `/strategy/${strategy.id}/table`, '现有策略记忆应保持视图形态')

  for (const pathname of ['/period/not-a-period', '/period/this-week/extra']) {
    assert(
      resolveWorkspaceNavTarget('trade', { pathname, search: '?status=win' }).pathname === '/list',
      `非法周期记忆 ${pathname} 应回退到全部`,
    )
  }
  for (const pathname of ['/review-cases/unknown', '/review-cases/focus/extra']) {
    assert(
      resolveWorkspaceNavTarget('case', { pathname, search: '?reviewStatus=focus' }).pathname === '/review-cases',
      `非法案例记忆 ${pathname} 应回退到案例全部`,
    )
  }
  assert(
    resolveWorkspaceNavTarget('case', {
      pathname: '/review-cases/focus/board',
      search: '?reviewStatus=focus',
    }).pathname === '/review-cases/focus/board',
    '合法案例范围应保留工作台视图后缀',
  )

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

export function testWorkspaceNavKeepsEncodedUnicodeStrategyMemory(): void {
  const memory = {
    pathname: '/strategy/%E5%AF%BC%E8%88%AA3/table',
    search: '?status=win',
  }
  const resolved = resolveWorkspaceNavTarget('trade', memory, [{ id: '导航3' }])

  assert(resolved.pathname === memory.pathname, '编码后的 Unicode 策略 ID 应匹配原始策略 ID')
  assert(resolved.search === memory.search, '合法策略记忆应保留筛选条件')
}

export function testWorkspaceNavRejectsMalformedEncodedStrategyMemory(): void {
  const resolved = resolveWorkspaceNavTarget(
    'trade',
    { pathname: '/strategy/%E0%A4%A/table', search: '?status=win' },
    [{ id: '导航3' }],
  )

  assert(resolved.pathname === '/list', '无法解码的策略 ID 应回退到交易列表')
  assert(resolved.search === '', '无法解码的策略 ID 不应保留筛选条件')
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
  const detailState = tradeDetailNavState({
    pathname: '/table',
    search: '?status=loss',
    anchorTradeId: trade.id,
  })
  assert(detailState.from?.anchorTradeId === trade.id, '详情路由 state 应保存来源交易锚点')

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

  const invalidCaseSource = resolveTradeDetailReturn({
    from: { pathname: '/list', search: '?status=loss', anchorTradeId: trade.id },
    tradeKind: 'case',
  })
  assert(invalidCaseSource.pathname === '/review-cases', '案例详情的失效交易来源应回退到案例列表')

  const invalidLiveSource = resolveTradeDetailReturn({
    from: { pathname: '/review-cases/mistakes', anchorTradeId: trade.id },
    tradeKind: 'live',
  })
  assert(invalidLiveSource.pathname === '/list', '交易详情的失效案例来源应回退到交易列表')
}

export function testTradeReturnAnchorSerializationExpires(): void {
  const createdAt = 1_000_000
  const serialized = serializeTradeReturnAnchor('trade-42', createdAt)

  assert(parseTradeReturnAnchor(serialized, createdAt) === 'trade-42', '返回锚点应可从版本化存储中恢复')
  assert(parseTradeReturnAnchor(serialized, createdAt + 30_001) === null, '超过恢复窗口的返回锚点必须过期')
  assert(parseTradeReturnAnchor('trade-42', createdAt) === null, '旧的无版本锚点不得无限保留')
}

export function testCaseDetailRejectsStaleLiveListContext(): void {
  const result = resolveTradeDetailReturn({
    from: { pathname: '/list', anchorTradeId: trade.id },
    listPath: '/list',
    listSearch: '?status=loss',
    tradeKind: 'case',
  })

  assert(result.pathname === '/review-cases', '案例详情不得返回 stale 交易列表上下文')
  assert(result.search === '', '案例类型回退不得保留 stale 交易筛选')
}

export function testLiveDetailRejectsStaleCaseListContext(): void {
  const result = resolveTradeDetailReturn({
    from: { pathname: '/review-cases/mistakes', anchorTradeId: trade.id },
    listPath: '/review-cases/focus',
    listSearch: '?symbol=BTCUSDT',
    tradeKind: 'live',
  })

  assert(result.pathname === '/list', '交易详情不得返回 stale 案例列表上下文')
  assert(result.search === '', '交易类型回退不得保留 stale 案例筛选')
}

export function testSymbolIconsResolveDefaultsAndOverrides(): void {
  assert(normalizeSymbol(' btc_usdt ') === 'BTCUSDT', '品种名应规范化为大写无分隔符')
  assert(detectSymbolMarket('BTCUSDT') === 'crypto', 'USDT 交易对应加密货币')
  assert(detectSymbolMarket('EURUSD') === 'forex', '六位货币对应外汇')
  assert(detectSymbolMarket('XAUUSD') === 'metal', 'XAU 对应贵金属')

  const btc = resolveSymbolIcon('BTCUSDT')
  assert(btc.type === 'glyph' && btc.glyph === '₿', 'BTC 默认使用比特币占位符')

  const xau = resolveSymbolIcon('XAUUSD')
  assert(xau.type === 'glyph' && xau.glyph === 'Au', 'A1：黄金默认使用平面 Au glyph')

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

export function testMergeImportPayloadKeepsOnlyExplicitPresetData(): void {
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
  assert(!merged.tagPresets?.includes('交易标签'), 'does not promote imported trade tags to presets')
  assert(
    !merged.mistakeTagPresets?.includes('追单'),
    'does not promote imported mistake tags to presets',
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

export function testListNavMatchesWorkbenchVisibleTrades(): void {
  const lossTrade: Trade = { ...trade, id: 'loss-trade', status: 'loss' }
  const openTrade: Trade = { ...trade, id: 'open-trade', status: 'open' }
  const deletedTrade: Trade = {
    ...trade,
    id: 'deleted-trade',
    status: 'open',
    deletedAt: new Date().toISOString(),
  }
  const hideClosedPrefs = { ...DEFAULT_DISPLAY, hideClosed: true }
  const trades = [lossTrade, openTrade, deletedTrade]

  const ordered = buildOrderedTradeIds(
    trades,
    { type: 'all', tradeKind: 'live' },
    hideClosedPrefs,
    [],
    '?status=loss',
  )
  assert(
    ordered.join(',') === 'loss-trade',
    'j/k 导航应与工作台一致：显式亏损筛选绕过 hideClosed，并排除软删',
  )

  const withoutFacet = buildOrderedTradeIds(
    trades,
    { type: 'all', tradeKind: 'live' },
    hideClosedPrefs,
    [],
    '',
  )
  assert(
    withoutFacet.join(',') === 'open-trade',
    '无状态筛选时 hideClosed 应隐藏亏损，且不含软删',
  )
}

export function testTradeExpiredAlignsWithZeroRemainingDays(): void {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const boundary: Trade = {
    ...trade,
    id: 'boundary',
    deletedAt: new Date(Date.now() - thirtyDaysMs).toISOString(),
  }
  assert(getTradeRemainingDays(boundary) === 0, '刚好满 30 天时应显示剩余 0 天')
  assert(isTradeExpired(boundary), '剩余 0 天必须视为过期，避免幽灵记录')

  const stillVisible: Trade = {
    ...trade,
    id: 'still-visible',
    deletedAt: new Date(Date.now() - (thirtyDaysMs - 12 * 60 * 60 * 1000)).toISOString(),
  }
  assert(getTradeRemainingDays(stillVisible) >= 1, '未满 30 天应仍有剩余天数')
  assert(!isTradeExpired(stillVisible), '未满 30 天不得 purge')
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
  assert(copy.sourceTradeId === source.id, 'case keeps a stable link to its source trade')
  assert(copy.caseType === 'mistake', 'mistake evidence should infer a mistake case')
  assert(copy.masteryState === 'new', 'newly extracted cases start as new knowledge')
  assert(Boolean(copy.nextReviewAt), 'newly extracted cases receive a first recheck date')
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
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const expired: Trade = {
    ...trade,
    id: 'expired',
    deletedAt: '2026-05-01T00:00:00.000Z',
  }
  const boundary: Trade = {
    ...trade,
    id: 'boundary',
    deletedAt: new Date(Date.now() - thirtyDaysMs).toISOString(),
  }
  const recent: Trade = {
    ...trade,
    id: 'recent',
    deletedAt: new Date().toISOString(),
  }
  const purged: string[] = []

  const count = await cleanExpiredTradeTrash([expired, boundary, recent], (id) => {
    purged.push(id)
  })

  assert(count === 2, 'expired and zero-remaining boundary trades are cleaned')
  assert(
    purged.sort().join(',') === 'boundary,expired',
    'purges both clearly expired and zero-remaining boundary trades',
  )
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

export function testUpsertTradesNotifiesOnce(): void {
  const prevTrades = useStore.getState().trades
  const prevCatalog = useStore.getState().symbolCatalog
  const prevTags = useStore.getState().tagPresets
  const prevMistakes = useStore.getState().mistakeTagPresets
  const strategyId = useStore.getState().strategies[0]?.id ?? 'uncategorized'

  const batch: Trade[] = [1, 2, 3].map((n) => ({
    ...trade,
    id: `batch-${n}`,
    ref: `TRD-BATCH-${n}`,
    symbol: `SYM${n}`,
    strategyId,
    tags: [`一次性标签${n}`],
    mistakeTags: [`一次性错误${n}`],
  }))

  let commits = 0
  const unsub = useStore.subscribe(() => {
    commits += 1
  })
  try {
    useStore.getState().upsertTrades(batch)
    assert(commits === 1, 'upsertTrades 应对整批只触发一次 store 通知')
    const ids = useStore.getState().trades.map((t) => t.id)
    assert(
      batch.every((t) => ids.includes(t.id)),
      'upsertTrades 应写入全部交易',
    )
    assert(
      JSON.stringify(useStore.getState().tagPresets) === JSON.stringify(prevTags),
      'upsertTrades 不应把案例标签提升为全局预置',
    )
    assert(
      JSON.stringify(useStore.getState().mistakeTagPresets) === JSON.stringify(prevMistakes),
      'upsertTrades 不应把案例错误提升为全局预置',
    )
  } finally {
    unsub()
    useStore.setState({
      trades: prevTrades,
      symbolCatalog: prevCatalog,
      tagPresets: prevTags,
      mistakeTagPresets: prevMistakes,
    })
  }
}

export function testCaseTagEditingDoesNotMutateGlobalPresets(): void {
  const prevTrades = useStore.getState().trades
  const prevTags = useStore.getState().tagPresets
  const prevMistakes = useStore.getState().mistakeTagPresets
  const editable = { ...trade, id: 'case-tag-scope', tags: [], mistakeTags: [] }

  try {
    useStore.setState({
      trades: [editable],
      tagPresets: ['全局标签'],
      mistakeTagPresets: ['全局错误'],
    })
    useStore.getState().addTag(editable.id, '当前案例标签')
    useStore.getState().updateTradeData(editable.id, { mistakeTags: ['当前案例错误'] })

    const state = useStore.getState()
    assert(state.trades[0]?.tags.includes('当前案例标签'), '自定义标签应写入当前案例')
    assert(state.trades[0]?.mistakeTags.includes('当前案例错误'), '自定义错误应写入当前案例')
    assert(
      JSON.stringify(state.tagPresets) === JSON.stringify(['全局标签']),
      '自定义标签不得修改全局预置',
    )
    assert(
      JSON.stringify(state.mistakeTagPresets) === JSON.stringify(['全局错误']),
      '自定义错误不得修改全局预置',
    )
  } finally {
    useStore.setState({
      trades: prevTrades,
      tagPresets: prevTags,
      mistakeTagPresets: prevMistakes,
      undoStack: [],
      redoStack: [],
    })
  }
}

export function testPersistSuspendNesting(): void {
  assert(getPersistSuspendDepth() === 0, '初始挂起深度应为 0')
  suspendPersist()
  suspendPersist()
  assert(getPersistSuspendDepth() === 2, 'suspend 应可嵌套')
  resumePersist({ flushNow: false })
  assert(getPersistSuspendDepth() === 1, 'resume 应逐层减一')
  resumePersist({ flushNow: false })
  assert(getPersistSuspendDepth() === 0, '全部 resume 后深度归零')
}

export function testNoteDraftsStayLocalUntilCleared(): void {
  resetNoteDraftsForTests()
  setNoteDraft('draft-1', '<p>hello</p>')
  assert(hasNoteDraft('draft-1'), '应记录本地草稿')
  assert(getNoteDraft('draft-1') === '<p>hello</p>', '应读回草稿 HTML')
  assert(noteDraftCountForTests() === 1, '草稿计数应为 1')
  clearNoteDraft('draft-1')
  assert(!hasNoteDraft('draft-1'), '清除后不应再有草稿')
  assert(noteDraftCountForTests() === 0, '清除后计数应为 0')
}

export function testTradeScrollTargetsPreferRegisteredHandler(): void {
  let seen = ''
  const unregister = registerTradeScrollTarget((tradeId) => {
    seen = tradeId
    return true
  })
  try {
    assert(requestScrollToTrade('row-42') === true, '已注册 handler 时应返回 true')
    assert(seen === 'row-42', 'handler 应收到目标 tradeId')
  } finally {
    unregister()
  }
  assert(requestScrollToTrade('row-42') === false, '注销后应回落为 false')
}
