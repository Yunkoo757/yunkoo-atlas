import type { Strategy } from '@/data/strategies'
import { getTradeRemainingDays, isTradeExpired, type Trade } from '@/data/trades'
import { DEFAULT_DISPLAY, filterTrades, applyDisplayPrefs, type DisplayPrefs } from '@/lib/tradeFilters'
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
import {
  listPathFromLegacyTablePath,
  pathWithWorkbenchMode,
  workbenchModeFromPathname,
} from '@/lib/routeContext'
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
  normalizePrimarySidebarOrder,
  reorderPrimarySidebarItem,
  resolvePrimarySidebarNav,
  resolvePinnedSecondaryNav,
} from '@/lib/sidebarNav'
import {
  capabilityNavRoutes,
  countSidebarRoute,
  countSidebarTarget,
  isCapabilityEnabledForWorkspace,
  isSidebarNavigationTarget,
  normalizeSidebarWorkspaceItems,
  reorderSidebarWorkspaceItem,
  resolveCapabilityNavRoute,
  resolveCapabilityRoute,
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  setCapabilityWorkspaceEnabled,
  sidebarTargetKey,
  systemCapabilityWorkspaces,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import {
  applyDisplayPrefs as applyWorkbenchDisplayPrefs,
  countWorkbenchVisibleTrades,
  deriveWorkbenchVisibleTrades,
  filterTrades as filterWorkbenchTrades,
  getWorkbenchVisibleTrades,
} from '@/lib/workbenchTrades'
import {
  resolveTradeDetailReturn,
  tradeDetailNavState,
} from '@/lib/tradeRoute'
import { resolveTradeDetailSourceCopy } from '@/views/detailSourceCopy'
import { detectSymbolMarket, normalizeSymbol, resolveSymbolIcon, collectSymbolOptions, normalizeSymbolCatalog } from '@/lib/symbolIcons'
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
  monthGroupRecency,
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
import { migrateShortcutBindings, useShortcutStore } from '@/store/shortcutStore'
import {
  findTradeReturnFocusTarget,
  parseTradeReturnAnchor,
  peekTradeReturnRequest,
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
  assert(defaultTradeKindForPath('/review-cases') === 'case', '案例库默认创建案例')
  assert(defaultTradeKindForPath('/review-cases/mistakes') === 'case', '案例子视图保持案例类型')
  assert(defaultTradeKindForPath('/sim') === 'paper', '模拟页默认创建模拟交易')
  assert(defaultTradeKindForPath('/paper/archive') === 'paper', 'paper 子路径保持模拟类型')
  assert(defaultTradeKindForPath('/practice') === 'paper', '旧 practice 路径兼容模拟类型')
  assert(defaultTradeKindForPath('/list') === 'live', '普通交易列表默认创建实盘交易')
}

export function testBusinessDatesUseTheLocalCalendarDay(): void {
  const localMidnight = new Date(2026, 6, 14, 0, 30, 0)
  assert(formatYmd(localMidnight) === '2026-07-14', '香港凌晨的业务日期不得被 UTC 截成前一天')
}

export async function testBusinessDateWritersAvoidUtcDateSlicing(): Promise<void> {
  const fs = await import('node:fs/promises')
  for (const file of [
    'src/store/useStore.ts',
    'src/lib/reviewCases.ts',
    'src/lib/reviewAnalytics.ts',
    'src/components/TradeComposer.tsx',
    'src/views/DetailView.tsx',
    'src/lib/csvImport.ts',
    'src/lib/notionImport.ts',
  ]) {
    const source = await fs.readFile(file, 'utf8')
    assert(
      !source.includes('toISOString().slice(0, 10)'),
      `${file} 的用户业务日期必须按本地日历日生成`,
    )
  }
}

export async function testElectronJournalImportRequiresExplicitReplacementConfirmation(): Promise<void> {
  const fs = await import('node:fs/promises')
  const ipcSource = await fs.readFile('electron/library/ipc.ts', 'utf8')
  const uiSource = await fs.readFile('src/components/DataIOContent.tsx', 'utf8')
  const prepareIndex = ipcSource.indexOf("ipcMain.handle('journal:prepareImport'")
  const commitIndex = ipcSource.indexOf("ipcMain.handle('journal:commitPreparedImport'")
  assert(prepareIndex >= 0 && commitIndex > prepareIndex, '桌面整库导入必须先隔离检查，再开放独立提交入口')
  const commitSource = ipcSource.slice(commitIndex, ipcSource.indexOf("ipcMain.handle('backup", commitIndex))
  assert(
    commitSource.includes('assertWriterSession(event, payload?.writerToken, activeStorage)'),
    '整库恢复提交必须绑定当前窗口与当前资料库生命周期，阻止旧窗口或过期操作覆盖资料库',
  )
  assert(
    uiSource.includes('title="确认恢复完整资料库"') &&
      uiSource.includes("archiveRestoring ? '正在安全恢复…' : '替换当前资料库'"),
    '桌面整库导入必须在渲染层展示明确的替换确认，不得检查后自动提交',
  )
  assert(
    uiSource.includes('void cancelPreparedDesktopArchive()') &&
      uiSource.includes('onClick={() => void commitDesktopArchive()}'),
    '覆盖确认必须提供取消路径，且只有明确点击替换动作才可提交',
  )
}

export function testPrimarySidebarNavigationMatchesApprovedArchitecture(): void {
  const routes = PRIMARY_NAV.map((item) => item.to)
  const expected = ['/list', '/dashboard', '/weekly-review', '/review-cases', '/review-session']
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
  assert(paper?.label === '模拟盘', 'paper 项侧栏文案应为「模拟盘」')
  assert(
    JSON.stringify(DEFAULT_SIDEBAR_PINS) === JSON.stringify(['active']),
    '默认 sidebarPins 只保留进行中；星标、错过与模拟由交易日志顶部切换承载',
  )
}

export function testReorderSidebarWorkspaceItemKeepsPlacementGroups(): void {
  const items = normalizeSidebarWorkspaceItems([
    { id: 'a', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'b', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 1 },
    { id: 'c', target: { kind: 'system', id: 'missed' }, placement: 'pinned', order: 2 },
    { id: 'd', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 3 },
    { id: 'e', target: { kind: 'case-view', scope: 'focus' }, placement: 'pinned', order: 4 },
  ])
  assert(
    items.map((item) => item.id).join(',') === 'system:active,system:favorites,system:missed,system:paper,case-view:focus',
    '规范化后 id 应与目标 key 对齐',
  )
  const moved = reorderSidebarWorkspaceItem(items, 'system:active', 'case-view:focus')
  assert(
    moved.filter((item) => item.placement === 'pinned').map((item) => item.id).join(',') ===
      'case-view:focus,system:active',
    '常驻组内应能重排，内置交易日志子视图不得重新进入侧栏',
  )
  assert(
    moved.find((item) => item.id === 'system:missed')?.placement === 'overflow',
    '重排常驻时不得把内部配置项移出 overflow',
  )
  assert(
    reorderSidebarWorkspaceItem(items, 'system:active', 'system:missed') === items,
    '跨 placement 拖放应被拒绝',
  )
}

export function testCapabilityPinsStaySingleWithWorkspaceVisibility(): void {
  const merged = normalizeSidebarWorkspaceItems([
    {
      id: 'system:missed',
      target: { kind: 'system', id: 'missed', workspaces: ['trade'] },
      placement: 'pinned',
      order: 0,
    },
    {
      id: 'legacy-paper-missed',
      target: { kind: 'quick-view', workspace: 'paper', view: 'missed' },
      placement: 'pinned',
      order: 1,
    },
    {
      id: 'legacy-case-missed',
      target: { kind: 'quick-view', workspace: 'case', view: 'missed' },
      placement: 'overflow',
      order: 2,
    },
  ])

  assert(merged.length === 1, '错过机会侧栏必须只保留一项')
  assert(merged[0]?.target.kind === 'system' && merged[0].target.id === 'missed', '应归一为 system:missed')
  assert(
    merged[0]?.target.kind === 'system' &&
      systemCapabilityWorkspaces(merged[0].target).join(',') === 'trade,paper',
    '错过机会只应合并实盘与模拟执行事件，旧案例快捷项必须从能力范围移除',
  )

  for (const currentPathname of ['/list', '/sim', '/review-cases', '/settings', '/dashboard']) {
    const resolved = resolveSidebarWorkspaceItem(
      merged[0]!,
      { savedViews: [], strategies: [] },
      currentPathname,
    )
    assert(
      resolved.pathname === '/list' && resolved.search === '?view=missed',
      `${currentPathname} 必须固定进入交易日志错过视图`,
    )
  }
  const activeRoute = resolveCapabilityNavRoute('active', ['trade', 'paper'], '/sim')
  assert(
    activeRoute.pathname === '/sim' && activeRoute.search === '?filter=active',
    '进行中能力仍应优先解析当前工作区',
  )
  assert(resolveCapabilityRoute('active', 'case') === null, '案例不得配置进行中能力')
  assert(
    capabilityNavRoutes('missed', ['trade', 'paper']).length === 1,
    '错过机会只应有一个交易日志视图路由',
  )

  const resolved = resolveSidebarWorkspaceItem(
    merged[0]!,
    { savedViews: [], strategies: [] },
    '/sim',
  )
  assert(resolved.label === '错过机会', '侧栏仍显示单一短名')
  assert(resolved.pathname === '/list' && resolved.search === '?view=missed', '链接必须固定指向交易日志错过视图')
  for (const [pathname, search] of [
    ['/sim', '?status=missed'],
    ['/review-cases', '?caseType=missed'],
  ] as const) {
    assert(
      resolveSidebarSelection({ pathname, search, items: [resolved] }).activeWorkspaceItemId === undefined,
      `${pathname}${search} 不得高亮聚合入口`,
    )
  }
  assert(sidebarTargetKey(merged[0]!.target) === 'system:missed', '能力项 key 保持唯一')

  const tradeOnly = setCapabilityWorkspaceEnabled(
    [{ id: 'system:missed', target: { kind: 'system', id: 'missed', workspaces: ['trade', 'paper'] }, placement: 'pinned', order: 0 }],
    'missed',
    'paper',
    false,
  )
  assert(
    tradeOnly[0]?.target.kind === 'system' &&
      systemCapabilityWorkspaces(tradeOnly[0].target).join(',') === 'trade',
    '取消勾选应收窄可见工作区且不拆成多项',
  )
  assert(isCapabilityEnabledForWorkspace(tradeOnly, 'missed', 'paper') === false, '取消后模拟域不得生效')
  assert(isCapabilityEnabledForWorkspace(tradeOnly, 'missed', 'trade') === true, '交易日志域应仍生效')
  const kept = setCapabilityWorkspaceEnabled(tradeOnly, 'missed', 'trade', false)
  assert(
    kept === tradeOnly,
    '关闭最后一个 missed 来源必须保持原状态',
  )
}

export function testMissedSidebarCountUsesAggregateInclusionScope(): void {
  const liveMissed: Trade = { ...trade, id: 'live-missed', tradeKind: 'live', status: 'missed' }
  const paperMissed: Trade = { ...trade, id: 'paper-missed', tradeKind: 'paper', status: 'missed' }
  const linkedCase: Trade = {
    ...trade,
    id: 'linked-missed-case',
    tradeKind: 'case',
    status: 'loss',
    caseType: 'missed',
    sourceTradeId: liveMissed.id,
  }
  const resolved = resolveSidebarWorkspaceItem(
    {
      id: 'system:missed',
      target: { kind: 'system', id: 'missed', workspaces: ['trade', 'paper'] },
      placement: 'pinned',
      order: 0,
    },
    { savedViews: [], strategies: [] },
  )

  assert(
    countSidebarTarget(resolved, {
      trades: [liveMissed, paperMissed, linkedCase],
      starredIds: [],
      display: DEFAULT_DISPLAY,
    }) === 2,
    '错过机会侧栏计数必须使用包含范围内的去重聚合总数',
  )
}

export async function testSidebarTargetPickerConfiguresVisibilityNotDuplicatePins(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/sidebar/SidebarTargetPicker.tsx', 'utf8')
  const editor = await fs.readFile('src/components/sidebar/SidebarWorkspaceEditor.tsx', 'utf8')
  const sidebar = await fs.readFile('src/components/Sidebar.tsx', 'utf8')
  assert(source.includes('toggleCapabilityWorkspace'), '应通过勾选配置同一能力的可见工作区')
  assert(source.includes('setCapabilityWorkspaceEnabled'), '添加项目应复用统一的可见范围写入')
  assert(!source.includes("id: 'missed'"), '错过机会已属于交易日志顶部快捷视图，不得再出现在侧栏目标选择器')
  assert(!source.includes('canonicalQuickViewTarget'), '不得再按工作区拆成多个钉选目标')
  assert(!editor.includes('sb-editor-capability-scopes'), '管理页不得再放可见工作区行内勾选')
  assert(!editor.includes('setCapabilityWorkspaceEnabled'), '管理页不得写入能力可见范围')
  assert(sidebar.includes('buildCapabilityVisibilityItems'), '侧栏能力项应就地提供可见工作区菜单')
  assert(sidebar.includes('sb-workspace-capability-menu'), '侧栏能力项应有悬停 ⋯ 入口')
  assert(sidebar.includes('onContextMenu'), '侧栏能力项应支持右键配置可见工作区')
  assert(sidebar.includes('setCapabilityWorkspaceEnabled'), '侧栏菜单应写入同一能力项')
}

export async function testDesktopSidebarConsumesUnifiedWorkspaceNavigationContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/Sidebar.tsx', 'utf8')
  const editor = await fs.readFile('src/components/sidebar/SidebarWorkspaceEditor.tsx', 'utf8')
  const defaultSystemTargets = DEFAULT_DISPLAY.sidebarWorkspaceItems
    .filter((item) => item.target.kind === 'system')
    .map((item) => item.target.kind === 'system' ? item.target.id : '')

  assert(
    defaultSystemTargets.join(',') === 'active',
    '默认工作区配置不得重复交易日志顶部的星标、错过与模拟视图',
  )
  assert(
    PRIMARY_NAV.map((item) => item.id).join(',')
      === 'trades,dashboard,weeklyReview,reviewCases,reviewSession',
    '核心模块必须收敛为交易日志、统计分析、周期复盘、案例库和随机复盘',
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

  assert(dailyItems.length === 5, '日常列表应保留进行中与自定义 pinned 中的有效项')
  assert(!dailyItems.some((item) => item.item.id === 'saved-invalid'), '失效项不得进入日常列表')
  assert(source.includes('data-sidebar-overflow'), 'Sidebar 应为 overflow 项渲染「更多」分区')
  assert(source.includes('sb-workspace-editor-backdrop'), 'Sidebar 管理器应支持点击外部关闭')
  assert(source.includes('state.display.sidebarWorkspaceItems'), 'Sidebar 应读取统一工作区配置')
  assert(source.includes('resolveSidebarWorkspaceItem'), 'Sidebar 应通过统一解析器准备日常项')
  assert(source.includes('resolveSidebarSelection'), 'Sidebar 应通过统一选择器保证唯一强选中态')
  assert(source.includes('isCapabilityEnabledForWorkspace'), 'Sidebar 应按当前工作区隐藏未开启的能力项')
  assert(source.includes('workspaceKindFromPath'), 'Sidebar 应按当前路径判断能力可见工作区')
  assert(source.includes("if (target.id === 'missed') return true"), '聚合错过入口不得因当前工作区被隐藏')
  assert(source.includes('buildCapabilityVisibilityItems'), 'Sidebar 应在能力项就地配置可见工作区')
  assert(!source.includes('sb-item-count'), '侧栏导航已做减法，不应恢复右侧数量噪声')
  assert(editor.includes('reorderSidebarWorkspaceItem'), '侧栏管理器应支持工作区项自定义拖拽排序')
  assert(source.includes('data-primary-id'), '工作区主导航必须提供排序命中区')
  assert(editor.includes('reorderPrimarySidebarItem'), '工作区主导航排序必须收口到管理器')
  assert(!source.includes('sb-row-drag-handle'), '日常侧栏不得同时显示来源菜单和拖拽抓手')
  assert(source.includes('sidebarPrimaryOrder'), 'Sidebar 必须读取并持久化用户工作区顺序')
  assert(source.includes('<StrategyIcon'), '侧栏策略入口必须复用真实策略图标组件')
  assert(
    source.includes("item.item.target.kind === 'strategy'"),
    '侧栏只能为策略入口读取策略自身的图标与颜色',
  )
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
      state.strategies.map((strategy) => `${strategy.id}:${strategy.name}`).join(',') ===
        'uncategorized:未分类',
      '新建交易库应只提供中性的未分类策略',
    )
    assert(
      state.tagPresets.length === 0,
      '新建交易库不应预置个人化普通标签',
    )
    assert(
      state.mistakeTagPresets.join(',') ===
        '缺乏耐心,仓位大小错误,修改止损,情绪化交易',
      '新建交易库应只保留少量通用错误标签',
    )
    assert(
      state.profile.displayName === '交易者',
      '新建交易库应使用中性的显示名称',
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
    'global.commandPaletteMod': 'mod+k',
    'global.newTrade': 'n',
    'global.newCase': 'shift+n',
    'global.newQuickNote': 'shift+alt+n',
    'global.undo': 'mod+z',
    'global.redo': 'mod+shift+z',
    'global.closeOverlay': 'escape',
    'global.toggleFullscreen': 'f11',
    'nav.quickNotes': 'alt+n',
    'nav.active': 'alt+1',
    'nav.favorites': 'alt+2',
    'nav.missed': 'alt+3',
    'nav.sim': 'g',
    'nav.list': 'alt+w',
    'nav.reviewCases': 'alt+c',
    'nav.weeklyReview': 'alt+4',
    'nav.reviewSession': 'alt+6',
    'nav.dashboard': 'i',
    'nav.strategies': 'o',
    'nav.strategySlot1': 'mod+1',
    'nav.strategySlot2': 'mod+2',
    'nav.strategySlot3': 'mod+3',
    'nav.strategySlot4': 'mod+4',
    'nav.strategySlot5': 'mod+5',
    'nav.strategySlot6': 'mod+6',
    'nav.strategySlot7': 'mod+7',
    'nav.strategySlot8': 'mod+8',
    'nav.strategySlot9': 'mod+9',
    'view.list': 'l',
    'view.board': 'b',
    'trade.prev': 'q',
    'trade.next': 'e',
    'trade.backToList': 'escape',
    'list.focusNext': 'e',
    'list.focusPrev': 'q',
    'list.openFocused': 'enter',
    'list.selectAll': 'mod+a',
    'list.clearSelection': 'escape',
    'list.toggleFilters': 'f',
    'reviewSession.unfamiliar': '1',
    'reviewSession.recheck': '2',
    'reviewSession.mastered': '3',
    'reviewSession.skip': 'n',
    'reviewSession.back': 'p',
    'reviewSession.exit': 'escape',
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

  const migrated = migrateShortcutBindings({
    'view.list': { key: 'l' },
    'view.table': { key: 't' },
  })
  assert(!('view.table' in migrated), '历史表格快捷键不得继续进入运行时配置')
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
    getAssetStats: async () => ({ count: 0, totalBytes: 0, missingCount: 0 }),
    importAssets: async () => undefined,
    commitImport: async () => undefined,
  }

  const migrated = await migrateFromLocalStorageIfNeeded(adapter)
  assert(migrated, '首次安装应生成并保存初始快照')
  if (saved === null) throw new Error('首次安装应写入可读取的初始快照')
  const snapshot: PersistedSnapshot = saved
  assert(snapshot.trades.length === 0, '首次安装必须从真实空库开始，不得注入演示成交')
  assert(
    snapshot.strategies.map((strategy) => `${strategy.id}:${strategy.name}`).join(',') ===
      'uncategorized:未分类',
    '首次安装快照应固化中性未分类策略',
  )
  assert(
    snapshot.tagPresets?.length === 0,
    '首次安装快照不应固化个人化普通标签',
  )
  assert(
    snapshot.mistakeTagPresets?.join(',') === '缺乏耐心,仓位大小错误,修改止损,情绪化交易',
    '首次安装快照应固化少量通用错误标签',
  )
  assert(
    snapshot.profile?.displayName === '交易者',
    '首次安装快照应固化中性显示名称',
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

export async function testMissedOpportunityUsesTheTradeLogShellContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const app = await fs.readFile('src/App.tsx', 'utf8')
  const workspaceViews = await fs.readFile('src/lib/workspaceViews.ts', 'utf8')
  const tradeWorkspaceContext = await fs.readFile('src/components/TradeWorkspaceContext.tsx', 'utf8')
  const filterBar = await fs.readFile('src/components/ui/FilterBar.tsx', 'utf8')
  const tradeFilters = await fs.readFile('src/components/trades/TradeFilters.tsx', 'utf8')
  const missedRouteStart = app.indexOf('path="/missed"')
  const missedRouteEnd = app.indexOf('path="/period/:slug"', missedRouteStart)
  const missedRouteBlock = app.slice(missedRouteStart, missedRouteEnd)

  assert(
    missedRouteBlock.includes('<LegacyTradeLogRedirect filter="missed" />'),
    '/missed 兼容入口必须收敛到交易日志工作台',
  )
  assert(!app.includes("import { MissedOpportunitiesView }"), '生产路由不得继续挂载独立错过机会页面壳')
  assert(
    workspaceViews.includes("{ id: 'missed', label: '错过机会', pathname: '/list', search: '?view=missed' }"),
    '顶部错过机会必须只切换交易日志 view 查询',
  )
  assert(
    !workspaceViews.includes("label: '错过机会', pathname: '/review-cases'"),
    '案例库不得继续提供错过机会快捷入口',
  )
  assert(tradeWorkspaceContext.includes('选择交易阶段'), '交易工作台必须提供统一阶段入口')
  assert(filterBar.includes('actions?: ReactNode'), 'FilterBar 必须继续提供标准右侧动作槽')
  assert(
    app.includes('filterActions={<TradeWorkspaceContext page="log" compact />}'),
    '交易日志的数据范围必须并入筛选行，避免与案例库切换时列表纵向跳动',
  )
  assert(
    !app.includes('header={<TradeWorkspaceContext page="log" />}'),
    '交易日志不得恢复独占的数据范围行',
  )
  assert(tradeFilters.includes('actions={actions}'), '交易筛选栏必须透传统一的数据范围动作')
}

export async function testDataSettingsMatchesDesktopBackupRetentionPolicy(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8')
  const backupSource = await fs.readFile('electron/library/backup.ts', 'utf8')

  assert(backupSource.includes('DEFAULT_MAX_BACKUPS = 7'), '桌面端必须继续执行 7 份备份上限')
  assert(!source.includes('最多保留 20 份'), '数据设置不得继续展示旧的 20 份备份上限')
  assert(
    source.includes('await Promise.all([refreshBackups(), refreshHealth()])'),
    '创建、恢复或删除备份后应同步刷新恢复点列表和存储健康数据',
  )
}

export function testPrimarySidebarKeepsLegacyOrderCompatibleButRendersCanonicalOrder(): void {
  assert(
    normalizePrimarySidebarOrder(['dashboard', 'trades', 'dashboard', 'unknown'])
      .join(',') === 'dashboard,trades,weeklyReview,reviewCases,reviewSession',
    '旧快照中的合法入口顺序应被兼容读取，并补齐新的一级入口',
  )
  assert(
    resolvePrimarySidebarNav().map((item) => item.id).join(',')
      === 'trades,dashboard,weeklyReview,reviewCases,reviewSession',
    '未自定义时工作区导航必须使用标准顺序',
  )
  assert(
    reorderPrimarySidebarItem(undefined, 'reviewCases', 'dashboard').join(',')
      === 'trades,reviewCases,dashboard,weeklyReview,reviewSession',
    '拖动工作区入口必须生成可持久化的新顺序',
  )
  assert(
    reorderPrimarySidebarItem(undefined, 'trades', 'dashboard').join(',')
      === 'dashboard,trades,weeklyReview,reviewCases,reviewSession',
    '相邻工作区入口向下移动时不得原地不动',
  )
  assert(
    reorderPrimarySidebarItem(undefined, 'dashboard', 'trades').join(',')
      === 'dashboard,trades,weeklyReview,reviewCases,reviewSession',
    '相邻工作区入口向上移动时必须保持对称语义',
  )
  assert(
    reorderPrimarySidebarItem(undefined, 'trades', 'trades').join(',')
      === 'trades,dashboard,weeklyReview,reviewCases,reviewSession',
    '拖到自身时不得改变工作区入口顺序',
  )
  assert(
    resolvePrimarySidebarNav(['reviewSession', 'trades']).map((item) => item.id).join(',')
      === 'reviewSession,trades,dashboard,weeklyReview,reviewCases',
    '侧栏必须按已保存顺序渲染并补齐新增入口',
  )
}

export async function testDesktopShellDisablesAccidentalSelectionAndAnimatesModalExit(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [globalCss, sidebarSource, sidebarEditorSource, exitSource, menuSource, selectSource, filterSource] = await Promise.all([
    fs.readFile('src/styles/global.css', 'utf8'),
    fs.readFile('src/components/Sidebar.tsx', 'utf8'),
    fs.readFile('src/components/sidebar/SidebarWorkspaceEditor.tsx', 'utf8'),
    fs.readFile('src/components/ui/useExitClone.ts', 'utf8'),
    fs.readFile('src/components/Menu.tsx', 'utf8'),
    fs.readFile('src/components/ui/Select.tsx', 'utf8'),
    fs.readFile('src/components/trades/TradeFilters.tsx', 'utf8'),
  ])
  assert(/body\s*\{[\s\S]*?user-select:\s*none;/.test(globalCss), '应用外壳应禁用普通文本拖选')
  assert(globalCss.includes("[contenteditable='true']") && globalCss.includes('user-select: text'), '编辑区必须保留文字选择能力')
  assert(sidebarSource.includes('data-primary-id'), '工作区主导航必须提供排序命中区')
  assert(sidebarEditorSource.includes('reorderPrimarySidebarItem'), '工作区主导航必须在管理器中支持排序')
  assert(sidebarSource.includes('sidebarPrimaryOrder'), 'Sidebar 必须读取并写入用户工作区顺序')
  assert(sidebarEditorSource.includes('reorderSidebarWorkspaceItem'), '我的空间仍应在管理器中支持自定义排序')
  assert(!sidebarSource.includes('sb-row-drag-handle'), '日常侧栏不得暴露拖拽抓手')
  assert(!sidebarSource.includes('sb-workspace-drag-ghost'), '侧栏拖拽不得生成跟随鼠标的浮动窗口')
  assert(exitSource.includes('appendExitClone'), '条件卸载弹层应保留离场快照')
  for (const [name, source] of [
    ['菜单', menuSource],
    ['选择框', selectSource],
    ['筛选器', filterSource],
  ] as const) {
    assert(source.includes('useExitClone'), `${name}关闭时应衔接短促淡出，不得瞬间消失`)
  }
}

export async function testStorageHealthSummaryUsesQuietInlineContent(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/DataIOContent.css', 'utf8')
  assert(source.includes('.storage-summary'), '资料概况应保留安静的行内摘要')
  assert(!source.includes('.health-note'), '旧版常驻健康警告不应恢复')
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
    defaultItems.map((item) => item.id).join(',') === 'active',
    '默认 pins 只应保留进行中',
  )
  assert(
    defaultItems.map((item) => item.to).join(',') === '/active',
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
    ...nativeStageState(),
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
    ...nativeStageState(),
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }, parsed.data)
  const items = merged.display.sidebarWorkspaceItems

  assert(items.length === 9, '重复目标应在导入边界去重且不丢失失效引用')
  assert(
    items.map((item) => item.id).join(',') ===
      [
        'system:active',
        'saved-view:saved-valid',
        `strategy:${strategy.id}`,
        'case-view:focus',
        'system:paper',
        'saved-view:deleted-view',
        'strategy:deleted-strategy',
        'case-view:reviewed',
        'case-view:mistakes',
      ].join(','),
    '导入应按目标 key 规范化 id 并保留顺序',
  )
  assert(items.filter((item) => item.placement === 'pinned').length === 8, '导入后最多保留 8 个 pinned')
  assert(items[4]?.placement === 'overflow', '旧模拟盘项应保留兼容数据但退出侧栏导航')
  assert(items[8]?.placement === 'pinned', '隐藏旧项不得占用可见侧栏容量')
  assert(items.some((item) => item.id === 'saved-view:deleted-view'), '导入不得删除失效保存视图引用')
  assert(items.some((item) => item.id === 'strategy:deleted-strategy'), '导入不得删除失效策略引用')
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
    ...nativeStageState(),
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }, {
    version: 6,
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY, sidebarWorkspaceItems: corruptedItems },
  })

  assert(merged.display.sidebarWorkspaceItems.length === 2, 'mergeImportPayload 应按目标去重损坏的工作区项目')
  assert(
    merged.display.sidebarWorkspaceItems.map((item) => item.id).join(',') === 'system:active,system:favorites',
    '同 id 不同目标应规范化为各自的目标 key',
  )
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
    { id: 'case-unreviewed', target: { kind: 'case-view', scope: 'unreviewed' }, placement: 'pinned', order: 9 },
    { id: 'case-exemplar', target: { kind: 'case-view', scope: 'exemplar' }, placement: 'pinned', order: 10 },
    { id: 'saved-a-copy', target: { kind: 'saved-view', viewId: 'view-a' }, placement: 'pinned', order: 11 },
  ])

  assert(items.length === 11, '语义重复项应被删除')
  assert(items.filter((item) => item.placement === 'pinned').length === 8, '最多只能固定 8 项')
  assert(
    items.filter((item) => isSidebarNavigationTarget(item.target) && item.placement === 'overflow').length === 0,
    '隐藏的内置子视图不得占用可见侧栏容量',
  )
  assert(
    items.filter((item) => !isSidebarNavigationTarget(item.target) && item.placement === 'overflow').length === 3,
    '星标、错过与旧模拟盘项必须统一退出侧栏导航',
  )
  assert(items.map((item) => item.order).join(',') === '0,1,2,3,4,5,6,7,8,9,10', 'order 应连续重写')
}

export function testNormalizeSidebarWorkspaceItemsKeepsFirstDuplicateId(): void {
  const sameTarget = normalizeSidebarWorkspaceItems([
    { id: 'duplicate', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'other', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 1 },
  ])
  assert(sameTarget.length === 1, '相同目标只能保留一项')
  assert(sameTarget[0]?.id === 'system:active', '规范化后 id 应对齐目标 key')

  const sameRawId = normalizeSidebarWorkspaceItems([
    { id: 'duplicate', target: { kind: 'system', id: 'active' }, placement: 'pinned', order: 0 },
    { id: 'duplicate', target: { kind: 'system', id: 'favorites' }, placement: 'pinned', order: 1 },
  ])
  assert(sameRawId.length === 2, '相同原始 id 但目标不同时应保留为两项')
  assert(
    sameRawId.map((item) => item.id).join(',') === 'system:active,system:favorites',
    '损坏的同 id 项应按目标拆成规范化 key',
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
    assert(selection.activeWorkspaceItemId === undefined, `${alias} 不得激活旧 paper 侧栏项`)
    assert(selection.activePrimaryId === 'trades', `${alias} 应继续归属交易日志`)
    assert(selection.primaryContextOnly === false, `${alias} 应保持交易日志完整焦点态`)
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
    pathname: '/board',
    search: '?symbol=EURUSD&status=loss',
    items: [active, saved],
  })
  assert(exact.activeWorkspaceItemId === 'saved-loss', '完整查询精确匹配时只应激活保存视图')
  assert(exact.activePrimaryId === 'trades', '保存视图精确匹配时仍应标明所属交易日志页面')
  assert(exact.modifiedWorkspaceItemId === undefined, '精确匹配不应标记 modified')

  const modified = resolveSidebarSelection({
    pathname: '/active/board',
    search: '?symbol=EURUSD',
    items: [active, saved],
  })
  assert(modified.activeWorkspaceItemId === 'fixed-active', '同一路径叠加查询仍应激活固定项')
  assert(modified.modifiedWorkspaceItemId === 'fixed-active', '额外查询应把固定项标记为 modified')
  assert(modified.activePrimaryId === 'trades', '范围被修改时仍应保留所属交易日志页面身份')

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
      filter: { type: 'strategy', strategyId: strategy.id, tradeKind: 'live' } as const,
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
  assert(countSidebarTarget(cases[2]!.target, context) === 1, '侧栏策略数量必须只统计实盘记录')
}

export function testCoreSidebarRouteCountsMatchRestoredWorkbenchFiltering(): void {
  const today = formatYmd(new Date())
  const trades: Trade[] = [
    { ...trade, id: 'today-open', status: 'open', openedAt: today },
    { ...trade, id: 'today-loss', status: 'loss', openedAt: today },
    { ...trade, id: 'older-open', status: 'open', openedAt: '2026-06-01' },
    {
      ...trade,
      id: 'scoped-paper-win',
      tradeKind: 'paper',
      status: 'win',
      openedAt: today,
      closedAt: today,
    },
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
      pathname: '/today-record',
      search: '',
      filter: { type: 'period', period: 'today', tradeKind: 'live' } as const,
    },
    {
      pathname: '/list/board',
      search: '',
      filter: { type: 'all', tradeKind: 'live' } as const,
    },
    {
      pathname: '/list',
      search: '?status=loss',
      filter: { type: 'all', tradeKind: 'live' } as const,
    },
    {
      pathname: '/review-cases/focus',
      search: '',
      filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'focus' } as const,
    },
    {
      pathname: `/strategy/${strategy.id}`,
      search: '?kind=paper&range=30d',
      filter: {
        type: 'strategy',
        strategyId: strategy.id,
        analysisScope: { kind: 'paper', range: '30d' },
      } as const,
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

export function testLiveWorkbenchAndSidebarCountsUseCurrentArchiveByDefault(): void {
  const trades: Trade[] = [
    { ...trade, id: 'old-live', tradeKind: 'live', liveStageId: 'stage-old', status: 'win', openedAt: '2099-07-20', closedAt: '2099-07-20', closedTradingDayKey: '2099-07-20' },
    { ...trade, id: 'new-live', tradeKind: 'live', liveStageId: 'stage-current', status: 'win', openedAt: '2020-07-27', closedAt: '2020-07-27', closedTradingDayKey: '2020-07-27' },
    { ...trade, id: 'paper', tradeKind: 'paper', status: 'open', openedAt: '2026-07-20' },
    { ...trade, id: 'case', tradeKind: 'case', liveStageId: 'stage-current', openedAt: '2026-07-20' },
  ]
  const context = {
    trades,
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }
  const live = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'all', tradeKind: 'live' },
    search: '',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  })
  const currentCycle = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'all', tradeKind: 'live' },
    search: '?statsCycle=current',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  })
  const paper = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'all', tradeKind: 'paper' },
    search: '',
  })
  const cases = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    search: '',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  })

  assert(live.map((item) => item.id).join() === 'new-live', '交易日志缺省范围必须是当前实盘')
  assert(countSidebarRoute('/list', '', context) === 1, '侧栏交易日志计数必须使用当前实盘')
  assert(currentCycle.map((item) => item.id).join() === 'new-live', '显式 current 必须等同当前实盘')
  assert(countSidebarRoute('/list', '?statsCycle=current', context) === 1, '当前实盘侧栏计数必须与列表一致')
  assert(paper.map((item) => item.id).join() === 'paper', '模拟盘计数不得受实盘周期影响')
  assert(cases.map((item) => item.id).join() === 'case', '案例计数不得受实盘周期影响')
}

export function testLegacyCycleQueryCannotOverrideExplicitCurrentStageScope(): void {
  const options = {
    trades: [
      { ...trade, id: 'current-live', liveStageId: 'stage-current', status: 'open' },
      { ...trade, id: 'historical-live', liveStageId: 'stage-old', status: 'open' },
    ] as Trade[],
    filter: { type: 'all', tradeKind: 'live' } as const,
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  }
  for (const requested of ['all', 'pre-cycle', 'missing']) {
    const derived = deriveWorkbenchVisibleTrades({ ...options, search: `?statsCycle=${requested}` })
    assert(derived.visible.map((item) => item.id).join() === 'current-live', `${requested} 不得覆盖显式 current stage`)
  }
}

function nativeStageState() {
  return {
    liveStages: [{
      id: 'stage-current', sequence: 1, name: '当前阶段', status: 'current' as const,
      startsOn: '2026-01-01', endsOn: null, createdAt: '2026-01-01T00:00:00.000Z', archivedAt: null,
    }],
    currentLiveStageId: 'stage-current',
    scheduledStageRollover: null,
  }
}

export function testPendingWorkbenchScopeOnlyIncludesNullOwnership(): void {
  const pending = { ...trade, id: 'pending-owner', liveStageId: null, status: 'win' as const }
  const current = { ...trade, id: 'current-owner', liveStageId: 'stage-current', status: 'win' as const }
  const derived = deriveWorkbenchVisibleTrades({
    trades: [pending, current],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '?statsCycle=pending',
    stageScope: { kind: 'pending' },
  })
  assert(derived.visible.map((item) => item.id).join() === 'pending-owner', 'pending scope 只能包含 null 归属')
}

export function testHistoricalLiveUsesTheSharedWorkbenchWithOnlyItsDataScopeChanged(): void {
  const historical = {
    ...trade,
    id: 'historical-live',
    openedAt: '2026-01-15',
    closedAt: '2026-01-15',
    closedTradingDayKey: '2026-01-15',
    liveStageId: 'stage-old',
  }
  const current = {
    ...trade,
    id: 'current-live',
    openedAt: '2026-02-15',
    closedAt: '2026-02-15',
    closedTradingDayKey: '2026-02-15',
    liveStageId: 'stage-current',
  }
  const linkedCase = {
    ...trade,
    id: 'historical-case',
    tradeKind: 'case' as const,
    sourceTradeId: historical.id,
    liveStageId: 'stage-old',
  }
  const currentCase = {
    ...linkedCase,
    id: 'current-case',
    sourceTradeId: current.id,
    liveStageId: 'stage-current',
  }
  const options = {
    trades: [historical, current, linkedCase, currentCase],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '',
  }

  const history = deriveWorkbenchVisibleTrades({
    ...options,
    filter: { type: 'all', tradeKind: 'live', historicalLiveScope: 'trades' },
    stageScope: { kind: 'all-history', archivedStageIds: new Set(['stage-old']) },
  })
  assert(history.visible.map((item) => item.id).join() === 'historical-live', '历史实盘工作台只能显示重置前实盘')

  const cases = deriveWorkbenchVisibleTrades({
    ...options,
    filter: { type: 'all', tradeKind: 'case', historicalLiveScope: 'cases' },
    stageScope: { kind: 'all-history', archivedStageIds: new Set(['stage-old']) },
  })
  assert(cases.visible.map((item) => item.id).join() === 'historical-case', '历史实盘案例工作台只能显示历史来源案例')
}

export function testPlainStrategyRoutesKeepListSemanticsWhileAnalysisRoutesUseCurrentStage(): void {
  const strategyTrades: Trade[] = [
    {
      ...trade,
      id: 'old-closed-strategy',
      tradeKind: 'live',
      liveStageId: 'stage-old',
      status: 'win',
      openedAt: '2026-06-01',
      closedAt: '2026-06-02',
      closedTradingDayKey: '2026-06-02',
      pnl: 100,
      rMultiple: 2,
      resultSource: 'imported',
    },
    {
      ...trade,
      id: 'current-closed-strategy',
      tradeKind: 'live',
      liveStageId: 'stage-current',
      status: 'win',
      openedAt: '2026-07-02',
      closedAt: '2026-07-03',
      closedTradingDayKey: '2026-07-03',
      pnl: 150,
      rMultiple: 2,
      resultSource: 'imported',
    },
    {
      ...trade,
      id: 'current-open-strategy',
      tradeKind: 'live',
      liveStageId: 'stage-current',
      status: 'open',
      openedAt: '2026-07-04',
      closedAt: null,
      closedTradingDayKey: undefined,
      pnl: null,
      resultSource: undefined,
    },
  ]
  const context = {
    trades: strategyTrades,
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
  }
  const plain = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'strategy', strategyId: strategy.id, tradeKind: 'live' },
    search: '',
    stageScope: { kind: 'current', stageId: 'stage-current' },
  })
  const explicitCurrent = getWorkbenchVisibleTrades({
    ...context,
    filter: { type: 'strategy', strategyId: strategy.id, tradeKind: 'live' },
    search: '?statsCycle=current-strategy-cycle',
    stageScope: { kind: 'current', stageId: 'stage-current' },
  })
  const dashboardAnalysis = getWorkbenchVisibleTrades({
    ...context,
    filter: {
      type: 'strategy',
      strategyId: strategy.id,
      analysisScope: { kind: 'live', range: 'all' },
    },
    search: '?kind=live&range=all',
    stageScope: { kind: 'current', stageId: 'stage-current' },
  })

  assert(
    plain.map((item) => item.id).sort().join() ===
      'current-closed-strategy,current-open-strategy',
    '普通策略页无查询参数必须使用当前日志范围',
  )
  assert(
    explicitCurrent.map((item) => item.id).sort().join() === 'current-closed-strategy,current-open-strategy',
    '普通策略页显式当前范围必须保留当前日志中的未平仓记录',
  )
  assert(
    dashboardAnalysis.map((item) => item.id).join() === 'current-closed-strategy',
    'Dashboard 分析下钻仍必须用显式当前 stage 分析语义',
  )
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
    '交易日志顶部不得出现案例库入口',
  )
  assert(
    tradeViews.every((view) => ['/list', '/favorites', '/missed'].includes(view.pathname))
      && tradeViews.find((view) => view.id === 'week')?.search === '?period=this-week'
      && tradeViews.some((view) => view.id === 'starred')
      && tradeViews.some((view) => view.id === 'missed'),
    '交易日志快捷视图应统一承载常规筛选、星标与错过分类',
  )
  assert(
    caseViews.every((view) => view.pathname.startsWith('/review-cases')),
    '案例库顶部不得出现交易日志入口',
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
    getActiveWorkspaceView('trade', '/list', '?strategyId=navigation-2')?.id === 'all',
    '策略是交易日志上下文，仅带策略时顶部「全部」必须保持选中',
  )
  assert(
    searchForWorkspaceViewTarget('?strategyId=navigation-2&status=loss', { id: 'all' }) === '?strategyId=navigation-2',
    '策略页切回全部只能清除子筛选，不能离开当前策略',
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
  assert(rememberableWorkspaceKind('/today-record/table') === 'today', '旧表格链接仍应识别原工作区')
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
  assert(existingStrategy.pathname === `/strategy/${strategy.id}`, '旧表格记忆应迁移到策略列表')

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

  const migratedDisplay = normalizeDisplay({
    workspaceMemory: {
      trade: { pathname: '/active/table', search: '?status=open' },
    },
  })
  assert(
    migratedDisplay.workspaceMemory?.trade?.pathname === '/active',
    '历史表格工作区记忆应在载入时迁移到列表',
  )

  const migratedStageScope = normalizeDisplay({
    workspaceMemory: {
      trade: { pathname: '/list', search: '?liveStage=all-history&strategyId=navigation-2' },
    },
  })
  assert(
    migratedStageScope.workspaceMemory?.trade?.search === '?liveStage=all&strategyId=navigation-2',
    '已移除的历史聚合范围必须在载入时迁移为全部阶段',
  )
}

export function testWorkspaceNavKeepsEncodedUnicodeStrategyMemory(): void {
  const memory = {
    pathname: '/strategy/%E5%AF%BC%E8%88%AA3/table',
    search: '?status=win',
  }
  const resolved = resolveWorkspaceNavTarget('trade', memory, [{ id: '导航3' }])

  assert(resolved.pathname === '/strategy/%E5%AF%BC%E8%88%AA3', '编码后的旧表格记忆应迁移到策略列表')
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
  const groups = groupTradesByMonth([june, julyEarly, julyLate], new Date('2026-07-20T12:00:00.000Z'))

  assert(
    JSON.stringify(groups.map((group) => group.key)) === JSON.stringify(['2026-07', '2026-06']),
    '交易月份应按最近月份倒序排列',
  )
  assert(groups[0].items[0].id === 'jul-2', '同月交易应按交易日期倒序排列')
  assert(groups[0].recency === 'current', '当月分组应为 current')
  assert(groups[1].recency === 'recent', '上月分组应为 recent')
  assert(monthGroupRecency('2026-04', new Date('2026-07-20T12:00:00.000Z')) === 'archive', '三个月前应为 archive')
  assert(monthGroupRecency('unknown') === 'archive', '未知日期视为 archive')

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
  const canonicalNotionTrade = {
    ...trade,
    note: '<p>已规范化笔记</p>',
    psychology: 'Neutral',
    narrative: 'Bullish',
  }
  assert(
    promoteTradeNotionMeta(canonicalNotionTrade) === canonicalNotionTrade,
    '已规范化正文应复用原对象，避免每次启动重复扫描长笔记',
  )

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
  assert(workbenchModeFromPathname('/period/this-week/board') === 'board', '应从路径识别看板形态')
  assert(workbenchModeFromPathname('/strategy/%E5%AF%BC%E8%88%AA3/board') === 'board', '中文策略的编码路径应识别为看板形态')
  assert(workbenchModeFromPathname('/period/this-week') === 'list', '无后缀应为列表形态')
  assert(workbenchModeFromPathname('/table') === 'list', '旧表格链接不得恢复成可用视图模式')
  assert(listPathFromLegacyTablePath('/table') === '/list', '旧根表格链接应回退全部列表')
  assert(
    listPathFromLegacyTablePath('/review-cases/mistakes/table') === '/review-cases/mistakes',
    '旧案例表格链接应回退对应列表',
  )
}

export function testPopoverPositionStaysAnchoredInsideViewport(): void {
  assert(clampPopoverLeft(440, 480, 2048) === 440, '宽屏应保持与触发器左侧对齐')
  assert(clampPopoverLeft(440, 480, 900) === 412, '空间不足时应向左夹取到 8px 安全边距')
  assert(clampPopoverLeft(195, 359, 375) === 8, '窄屏弹层不得溢出视口右侧')
  assert(clampPopoverLeft(4, 359, 375) === 8, '窄屏弹层不得溢出视口左侧')
}

export function testTradeDetailReturnRemembersListView(): void {
  const detailState = tradeDetailNavState({
    pathname: '/board',
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

  for (const tradeKind of ['live', 'case'] as const) {
    const archiveBoardReturn = resolveTradeDetailReturn({
      from: {
        pathname: '/live-history/board',
        search: '?liveStage=stage-old&tab=cases&status=loss',
        restoreSearch: '?liveStage=stage-old&tab=cases&status=loss&anchor=case-1',
        anchorTradeId: 'case-1',
      },
      tradeKind,
    })
    assert(archiveBoardReturn.pathname === '/live-history/board', `${tradeKind} 历史看板详情必须返回原 board 路径`)
    assert(
      archiveBoardReturn.search === '?liveStage=stage-old&tab=cases&status=loss&anchor=case-1',
      `${tradeKind} 历史看板详情必须保留 stage、tab、筛选与滚动锚点`,
    )
  }

  const dashboardReturn = resolveTradeDetailReturn({
    from: { pathname: '/dashboard', search: '?kind=live&range=all&statsCycle=current' },
    tradeKind: 'live',
  })
  assert(dashboardReturn.pathname === '/dashboard', 'Dashboard 详情必须接受 Dashboard 作为返回来源')
  assert(
    dashboardReturn.search === '?kind=live&range=all&statsCycle=current',
    'Dashboard 详情返回必须保留当前分析查询',
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

  for (const tradeKind of ['live', 'paper', 'case'] as const) {
    const target = resolveTradeDetailReturn({
      from: {
        pathname: '/missed',
        search: '?symbol=XAUUSD&side=long',
        anchorTradeId: 'root-1',
      },
      tradeKind,
    })
    assert(target.pathname === '/missed', `${tradeKind} 必须能返回聚合页`)
    assert(target.search === '?symbol=XAUUSD&side=long', `${tradeKind} 必须保留聚合筛选`)
  }

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

  const riskSettingsReturn = resolveTradeDetailReturn({
    from: { pathname: '/settings/risk', search: '', anchorTradeId: trade.id },
    tradeKind: 'live',
  })
  assert(riskSettingsReturn.pathname === '/settings/risk', '风险修复后的交易详情必须返回风险设置')

  const invalidCaseRiskSource = resolveTradeDetailReturn({
    from: { pathname: '/settings/risk', search: '', anchorTradeId: trade.id },
    tradeKind: 'case',
  })
  assert(invalidCaseRiskSource.pathname === '/review-cases', '案例详情不得接受风险设置作为来源')

  const riskRepairReturn = resolveTradeDetailReturn({
    from: {
      pathname: '/settings/risk/data-repair',
      search: '?group=priority%3Amissing-loss-pnl',
      anchorTradeId: trade.id,
    },
    tradeKind: 'live',
  })
  assert(riskRepairReturn.pathname === '/settings/risk/data-repair', '实盘详情必须接受风险修复中心来源')
  assert(riskRepairReturn.search === '?group=priority%3Amissing-loss-pnl', '风险修复中心返回必须保留展开分组')

  const missingRiskRepairTradeReturn = resolveTradeDetailReturn({
    from: {
      pathname: '/settings/risk/data-repair',
      search: '?group=priority%3Amissing-close-date',
      anchorTradeId: 'risk-repair:purged-live-1',
    },
  })
  assert(
    missingRiskRepairTradeReturn.pathname === '/settings/risk/data-repair',
    '已彻底不存在的风险修复来源交易仍须返回修复中心',
  )
  assert(
    missingRiskRepairTradeReturn.search === '?group=priority%3Amissing-close-date',
    '缺失交易返回修复中心时不得丢失展开分组',
  )

  const invalidCaseRepairSource = resolveTradeDetailReturn({
    from: { pathname: '/settings/risk/data-repair', anchorTradeId: trade.id },
    tradeKind: 'case',
  })
  assert(invalidCaseRepairSource.pathname === '/review-cases', '案例详情不得接受风险修复中心来源')

  const weeklyReviewReturn = resolveTradeDetailReturn({
    from: {
      pathname: '/weekly-review',
      search: '?week=2026-07-20&tab=year&visual=mobile',
      anchorTradeId: 'weekly-trade:live-1',
    },
    tradeKind: 'live',
  })
  assert(weeklyReviewReturn.pathname === '/weekly-review', '实盘详情必须接受周复盘来源')
  assert(
    weeklyReviewReturn.search === '?week=2026-07-20&tab=year&visual=mobile',
    '周复盘返回目标必须保留完整查询参数',
  )

  const invalidPaperWeeklySource = resolveTradeDetailReturn({
    from: { pathname: '/weekly-review', anchorTradeId: 'weekly-trade:paper-1' },
    tradeKind: 'paper',
  })
  assert(invalidPaperWeeklySource.pathname === '/list', '模拟盘不得接受周复盘来源')

  const invalidCaseWeeklySource = resolveTradeDetailReturn({
    from: { pathname: '/weekly-review', anchorTradeId: 'weekly-trade:case-1' },
    tradeKind: 'case',
  })
  assert(invalidCaseWeeklySource.pathname === '/review-cases', '案例不得接受周复盘来源')

  const missingWeeklyTradeReturn = resolveTradeDetailReturn({
    from: {
      pathname: '/weekly-review',
      search: '?week=2026-07-20',
      anchorTradeId: 'weekly-trade:purged-live-1',
    },
  })
  assert(missingWeeklyTradeReturn.pathname === '/weekly-review', '已彻底不存在的周复盘来源交易仍须返回原周')
  assert(missingWeeklyTradeReturn.search === '?week=2026-07-20', '缺失交易返回时不得丢失原周')
}

export async function testTradeDetailSourceCopyNamesRiskRepairCenter(): Promise<void> {
  const riskRepairCopy = resolveTradeDetailSourceCopy({
    fromPathname: '/settings/risk/data-repair',
    returnPathname: '/settings/risk/data-repair',
    tradeKind: 'live',
  })
  assert(riskRepairCopy.breadcrumb === '风险数据修复中心', '风险修复来源必须使用完整面包屑名称')
  assert(riskRepairCopy.backAriaLabel === '返回修复中心', '风险修复来源返回图标必须使用修复中心标签')
  assert(riskRepairCopy.returnDestinationLabel === '修复中心', '风险修复来源空状态动作必须显示返回修复中心')

  const missedCopy = resolveTradeDetailSourceCopy({
    fromPathname: '/missed',
    returnPathname: '/missed',
    tradeKind: 'live',
  })
  assert(missedCopy.breadcrumb === '错过机会', '其他详情来源的面包屑不得改变')
  assert(missedCopy.backAriaLabel === '返回错过机会', '其他详情来源的返回标签不得改变')
  assert(missedCopy.returnDestinationLabel === '错过机会', '其他详情来源的空状态动作不得改变')

  for (const tradeKind of ['live', 'case'] as const) {
    const historyBoardCopy = resolveTradeDetailSourceCopy({
      fromPathname: '/live-history/board',
      returnPathname: '/live-history/board',
      tradeKind,
    })
    assert(historyBoardCopy.breadcrumb === '历史实盘', `${tradeKind} 历史 board 详情必须显示历史实盘来源`)
    assert(historyBoardCopy.backAriaLabel === '返回历史实盘', `${tradeKind} 历史 board 返回按钮必须使用历史实盘名称`)
    assert(historyBoardCopy.returnDestinationLabel === '历史实盘', `${tradeKind} 历史 board 缺失记录动作必须返回历史实盘`)
  }

  const fs = await import('node:fs/promises')
  const detailView = await fs.readFile('src/views/DetailView.tsx', 'utf8')
  const missingSurface = detailView.slice(detailView.indexOf('if (!trade) {'), detailView.indexOf('const activeNoteLoad'))
  assert(missingSurface.includes('aria-label={backAriaLabel}'), '缺失或已删除详情的返回图标必须使用来源标签')
  assert(missingSurface.includes('返回{returnDestinationLabel}'), '缺失或已删除详情的返回动作必须使用来源标签')
}

export async function testWeeklyReviewDetailSourceUsesDedicatedReturnCopy(): Promise<void> {
  const weeklyCopy = resolveTradeDetailSourceCopy({
    fromPathname: '/weekly-review',
    returnPathname: '/weekly-review',
    tradeKind: 'live',
  })
  assert(weeklyCopy.breadcrumb === '周复盘', '详情面包屑必须显示周复盘')
  assert(weeklyCopy.backAriaLabel === '返回周复盘', '详情返回按钮必须使用周复盘专属名称')

  const rejectedWeeklyCopy = resolveTradeDetailSourceCopy({
    fromPathname: '/weekly-review',
    returnPathname: '/list',
    tradeKind: 'paper',
  })
  assert(rejectedWeeklyCopy.breadcrumb === '模拟', '详情页周复盘文案资格必须使用已经过类型门禁的返回目标')
}

export async function testMissedDetailReturnKeepsCanonicalCopyAndFocusRecovery(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [detailView, returnAnchor] = await Promise.all([
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
    fs.readFile('src/hooks/useTradeReturnAnchor.ts', 'utf8'),
  ])

  assert(
    detailView.includes('resolveTradeDetailSourceCopy({'),
    '聚合来源详情必须显示“错过机会”面包屑',
  )
  const missedCopy = resolveTradeDetailSourceCopy({
    fromPathname: '/missed',
    returnPathname: '/missed',
    tradeKind: 'live',
  })
  assert(missedCopy.breadcrumb === '错过机会', '聚合来源详情必须显示“错过机会”面包屑')
  assert(missedCopy.backAriaLabel === '返回错过机会', '聚合来源详情返回按钮必须提供专属 aria-label')
  assert(
    returnAnchor.includes('findTradeReturnFocusTarget(target)') &&
      returnAnchor.includes('focus({ preventScroll: true })'),
    '返回锚点必须优先聚焦主动作，并阻止 focus 自行滚动',
  )
  assert(returnAnchor.includes('onMissing?: (tradeId: string) => void'), '返回锚点必须支持目标消失回调')
}

export function testTradeReturnAnchorSerializationExpires(): void {
  const createdAt = 1_000_000
  const serialized = serializeTradeReturnAnchor('trade-42', createdAt)

  assert(parseTradeReturnAnchor(serialized, createdAt) === 'trade-42', '返回锚点应可从版本化存储中恢复')
  assert(parseTradeReturnAnchor(serialized, createdAt + 30_001) === null, '超过恢复窗口的返回锚点必须过期')
  assert(parseTradeReturnAnchor('trade-42', createdAt) === null, '旧的无版本锚点不得无限保留')
}

export function testExpiredTradeReturnAnchorKeepsSingleUseFrozenRouteContext(): void {
  const createdAt = 1_000_000
  const serialized = serializeTradeReturnAnchor(
    'trade-42',
    createdAt,
    '?week=2026-07-20&tab=year',
    '',
  )
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const fakeStorage = {
    getItem: (key: string) => key === 'trade-return-anchor:/weekly-review' ? serialized : null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 1,
  } satisfies Storage
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: fakeStorage })
  try {
    const request = peekTradeReturnRequest(
      { pathname: '/weekly-review', search: '' },
      null,
      createdAt + 30_001,
    )
    assert(request?.restoreSearch === '?week=2026-07-20&tab=year', '锚点过期后仍须保留单次冻结路由上下文')
    assert(request?.tradeId === undefined, '过期锚点不得继续触发滚动与焦点恢复')
    const explicitRequest = peekTradeReturnRequest(
      { pathname: '/weekly-review', search: '' },
      {
        restoreTradeId: 'trade-explicit',
        restoreSearch: '?week=2026-07-20&tab=year',
        restoreSourceSearch: '',
        restoreCreatedAt: createdAt,
      },
      createdAt + 30_001,
    )
    assert(
      explicitRequest?.restoreSearch === '?week=2026-07-20&tab=year',
      '显式锚点过期后仍须保留单次冻结路由上下文',
    )
    assert(explicitRequest?.tradeId === undefined, '过期显式锚点不得继续触发滚动与焦点恢复')
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}

export function testTradeReturnFocusTargetSkipsHiddenAndDisabledPrimaryActions(): void {
  const candidate = (options: {
    visible?: boolean
    hidden?: boolean
    ariaHidden?: boolean
    disabled?: boolean
    tabIndex?: number
  } = {}): HTMLElement => {
    const element = {
      hidden: options.hidden ?? false,
      disabled: options.disabled ?? false,
      tabIndex: options.tabIndex ?? 0,
      getAttribute: (name: string) => {
        if (name === 'aria-hidden' && options.ariaHidden) return 'true'
        return null
      },
      closest: () => options.hidden || options.ariaHidden ? element : null,
      getClientRects: () => ({ length: options.visible === false ? 0 : 1 }),
    }
    return element as unknown as HTMLElement
  }

  const cssHiddenPrimary = candidate({ visible: false })
  const hiddenPrimary = candidate({ hidden: true })
  const ariaHiddenPrimary = candidate({ ariaHidden: true })
  const disabledPrimary = candidate({ disabled: true })
  const nonFocusablePrimary = candidate({ tabIndex: -1 })
  const sharedRowMenuButton = candidate()
  const primaryCandidates = [
    cssHiddenPrimary,
    hiddenPrimary,
    ariaHiddenPrimary,
    disabledPrimary,
    nonFocusablePrimary,
  ]
  const target = {
    querySelector: () => cssHiddenPrimary,
    querySelectorAll: (selector: string) => selector === '[data-trade-primary-action]'
      ? primaryCandidates
      : [...primaryCandidates, sharedRowMenuButton],
  } as unknown as HTMLElement

  assert(
    findTradeReturnFocusTarget(target) === sharedRowMenuButton,
    '隐藏、aria-hidden、禁用或不可聚焦的主动作必须回退到可见共享行菜单按钮',
  )
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
    empty.length === 0,
    '用户显式清空品种目录后不得重新注入固定品种',
  )
  assert(collectSymbolOptions([], []).length === 0, '空目录不得自行恢复默认品种')
  assert(normalizeSymbolCatalog(undefined).length > 0, '缺失旧数据仍应获得初始默认目录')
}

export function testNormalizeDisplayPersistsPrivacyModeSafely(): void {
  assert(normalizeDisplay({ privacyMode: true }).privacyMode, '直播模式必须随显示偏好持久化')
  assert(!normalizeDisplay({}).privacyMode, '旧资料库缺少直播模式字段时必须默认关闭')
}

export function testNormalizeDisplayPersistsSidebarRiskScopeSafely(): void {
  assert(normalizeDisplay({}).sidebarRiskScope === 'day', '旧资料库缺少侧栏风险周期时必须默认每日')
  assert(
    normalizeDisplay({ sidebarRiskScope: 'week' }).sidebarRiskScope === 'week'
      && normalizeDisplay({ sidebarRiskScope: 'month' }).sidebarRiskScope === 'month',
    '侧栏风险周期必须保留每周与每月偏好',
  )
  assert(
    normalizeDisplay({ sidebarRiskScope: 'quarter' } as unknown as Partial<DisplayPrefs>).sidebarRiskScope === 'day',
    '非法侧栏风险周期必须安全回退为每日',
  )
}

export function testNormalizeDisplayPersistsKeyboardFocusRingVisibilitySafely(): void {
  assert(
    DEFAULT_DISPLAY.showKeyboardFocusRings === false,
    '新资料库必须默认关闭键盘焦点高光',
  )
  assert(
    normalizeDisplay({}).showKeyboardFocusRings === false,
    '旧资料库缺少键盘焦点高光字段时必须默认关闭',
  )
  assert(
    normalizeDisplay({ showKeyboardFocusRings: true }).showKeyboardFocusRings === true,
    '显式开启的键盘焦点高光必须持久化保留',
  )
  assert(
    normalizeDisplay({ showKeyboardFocusRings: 'yes' } as unknown as Partial<DisplayPrefs>)
      .showKeyboardFocusRings === false,
    '非法键盘焦点高光值必须回退为关闭',
  )
}

export function testNormalizeDisplayPersistsListRowDensitySafely(): void {
  assert(DEFAULT_DISPLAY.listRowDensity === 'compact', '新资料库必须默认使用 44px 紧凑列表')
  assert(normalizeDisplay({}).listRowDensity === 'compact', '旧资料库缺少列表密度时必须回退到 44px')
  assert(
    normalizeDisplay({ listRowDensity: 'comfortable' }).listRowDensity === 'comfortable',
    '48px 舒展列表偏好必须持久化保留',
  )
  assert(
    normalizeDisplay({ listRowDensity: 'dense' } as unknown as Partial<DisplayPrefs>)
      .listRowDensity === 'compact',
    '非法列表密度必须安全回退到 44px',
  )
}

export async function testPrivacyModeIsOnlyExposedInDisplaySettings(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [topbar, settings] = await Promise.all([
    fs.readFile('src/components/Topbar.tsx', 'utf8'),
    fs.readFile('src/views/settings/DisplaySettingsPanel.tsx', 'utf8'),
  ])
  assert(!topbar.includes('privacyMode') && !topbar.includes('直播模式'), '顶栏不得显示直播模式入口')
  assert(settings.includes('label="直播模式"'), '显示设置必须保留直播模式开关')
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
    '主交易列表与看板应归一为同一路径',
  )
  assert(normalized[0]?.search.empty === undefined, '应移除空查询条件')
  assert(
    savedViewMatchesLocation(normalized[0]!, '/period/this-month/table', '?session=london'),
    '旧表格链接应兼容匹配同一保存视图',
  )

  const [legacyStarred, legacyMissed] = normalizeSavedTradeViews([
    { ...base, id: 'legacy-starred', pathname: '/favorites', search: {} },
    { ...base, id: 'legacy-missed', pathname: '/missed/board', search: {} },
  ])
  assert(
    legacyStarred?.pathname === '/list' && legacyStarred.search.view === 'starred',
    '旧星标保存视图必须迁移到交易日志同页查询',
  )
  assert(
    legacyMissed?.pathname === '/list' && legacyMissed.search.view === 'missed',
    '旧错过保存视图必须迁移到交易日志同页查询',
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

export function testDisplaySortingSupportsAscendingAndDescendingDirections(): void {
  assert(
    normalizeDisplay({ sortDirection: undefined }).sortDirection === 'desc' &&
      normalizeDisplay({ sortDirection: 'invalid' as DisplayPrefs['sortDirection'] }).sortDirection === 'desc',
    '旧资料库缺少排序方向或保存了非法值时，必须安全回退为倒序',
  )
  const records: Trade[] = [
    {
      ...trade,
      id: 'sort-low-old',
      openedAt: '2026-01-05',
      pnl: -200,
      conviction: 'low',
    },
    {
      ...trade,
      id: 'sort-high-new',
      openedAt: '2026-02-20',
      pnl: 500,
      conviction: 'urgent',
    },
    {
      ...trade,
      id: 'sort-empty-middle',
      openedAt: '2026-02-01',
      pnl: null,
      conviction: 'medium',
    },
  ]
  const sortedIds = (
    sortBy: DisplayPrefs['sortBy'],
    sortDirection: DisplayPrefs['sortDirection'],
  ) => applyDisplayPrefs(records, {
    ...DEFAULT_DISPLAY,
    hideClosed: false,
    sortBy,
    sortDirection,
  }).map((item) => item.id)

  assert(
    sortedIds('date', 'asc').join(',') ===
      'sort-low-old,sort-empty-middle,sort-high-new',
    '开仓时间正序应从早到晚',
  )
  assert(
    sortedIds('date', 'desc').join(',') ===
      'sort-high-new,sort-empty-middle,sort-low-old',
    '开仓时间倒序应从晚到早',
  )
  assert(
    sortedIds('pnl', 'asc').join(',') ===
      'sort-low-old,sort-high-new,sort-empty-middle',
    '盈亏正序应从低到高，空值保持在末尾',
  )
  assert(
    sortedIds('pnl', 'desc').join(',') ===
      'sort-high-new,sort-low-old,sort-empty-middle',
    '盈亏倒序应从高到低，空值保持在末尾',
  )
  assert(
    sortedIds('conviction', 'asc').join(',') ===
      'sort-low-old,sort-empty-middle,sort-high-new',
    '信心度正序应从低到高',
  )
  assert(
    sortedIds('conviction', 'desc').join(',') ===
      'sort-high-new,sort-empty-middle,sort-low-old',
    '信心度倒序应从高到低',
  )

  const ascendingGroups = groupTradesByMonth(records, new Date('2026-03-01'), 'asc')
  assert(
    ascendingGroups.map((group) => group.key).join(',') === '2026-01,2026-02' &&
      ascendingGroups[1]?.items.map((item) => item.id).join(',') ===
        'sort-empty-middle,sort-high-new',
    '按月份分组时，正序必须同时作用于月份和组内交易',
  )
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
    slotId: 0,
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
      ...nativeStageState(),
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
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
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

export function testNotionImportTargetsPaperAndCaseDomains(): void {
  const existingTrades: Trade[] = [
    { ...trade, id: 'existing-live', ref: 'TRD-7' },
    { ...trade, id: 'existing-case', ref: 'CAS-3', tradeKind: 'case' },
  ]
  const paper = executeNotionImport([preview(1)], [strategy], existingTrades, {
    tradeKind: 'paper',
  }).trades[0]
  assert(paper?.tradeKind === 'paper', 'Notion 必须能整批导入模拟回测')
  assert(paper?.ref === 'TRD-8', '模拟回测应与账户交易共用连续 TRD 编号')
  assert(paper?.caseType === undefined && paper?.masteryState === undefined, '模拟记录不得携带案例字段')

  const casePreviews = [preview(2), preview(3)]
  casePreviews[1]!.trade.reviewCategory = 'mistake'
  const cases = executeNotionImport(casePreviews, [strategy], existingTrades, {
    tradeKind: 'case',
  }).trades
  assert(cases.map((item) => item.ref).join(',') === 'CAS-4,CAS-5', '案例导入应使用独立连续 CAS 编号')
  assert(cases.every((item) => item.tradeKind === 'case'), '案例导入不得混入账户交易域')
  assert(cases[0]?.caseType === 'exemplar' && cases[1]?.caseType === 'mistake', '案例类型应根据复盘信息推断')
  assert(cases.every((item) => item.masteryState === 'new' && Boolean(item.nextReviewAt)), '导入案例应进入首次复看流程')
  assert(cases.every((item) => Boolean(item.recordedAt)), '导入案例应记录知识库收录时间')

  const missedPreview = preview(4)
  missedPreview.trade.status = 'missed'
  missedPreview.trade.mistakeTags = ['情绪化交易']
  missedPreview.trade.reviewCategory = 'mistake'
  const missedCase = executeNotionImport([missedPreview], [strategy], existingTrades, {
    tradeKind: 'case',
  }).trades[0]
  assert(missedCase?.caseType === 'missed', '未成交案例导入必须推断为错过机会')
  assert(
    missedCase?.reviewCategory === 'normal',
    '错过机会不得因错误标签把 reviewCategory 写成 mistake',
  )
  assert(
    missedCase?.mistakeTags.includes('情绪化交易'),
    '错过机会仍应保留错误标签作为「为何错过」的证据',
  )
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
    { type: 'starred', tradeKind: 'live' },
    [trade.id, paperTrade.id, reviewCase.id],
  )
  const casesOnly = filterTrades(
    [trade, paperTrade, reviewCase],
    { type: 'all', tradeKind: 'case' },
    [],
  )

  assert(starred.some((t) => t.id === trade.id), 'starred keeps live trades')
  assert(!starred.some((t) => t.id === paperTrade.id), '交易日志星标不得混入模拟')
  assert(!starred.some((t) => t.id === reviewCase.id), 'starred excludes review cases')
  assert(casesOnly.length === 1 && casesOnly[0]?.id === reviewCase.id, 'case view only shows cases')
}

export function testMissedWorkspaceStaysInsideLiveTradingJournal(): void {
  const liveMissed: Trade = { ...trade, id: 'live-missed', status: 'missed', tradeKind: 'live' }
  const paperMissed: Trade = {
    ...trade,
    id: 'paper-missed',
    status: 'missed',
    tradeKind: 'paper',
  }
  const caseMissed: Trade = {
    ...trade,
    id: 'case-missed',
    status: 'missed',
    tradeKind: 'case',
    caseType: 'missed',
  }
  const liveWin: Trade = { ...trade, id: 'live-win', status: 'win', tradeKind: 'live' }

  const missed = filterTrades(
    [liveMissed, paperMissed, caseMissed, liveWin],
    { type: 'missed', tradeKind: 'live' },
    [],
  )
  const sidebarMissed = getWorkbenchVisibleTrades({
    trades: [liveMissed, paperMissed, caseMissed, liveWin],
    filter: { type: 'missed', tradeKind: 'live' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: '',
  })
  const paperMissedOnly = getWorkbenchVisibleTrades({
    trades: [liveMissed, paperMissed, caseMissed, liveWin],
    filter: { type: 'all', tradeKind: 'paper' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: '?status=missed',
  })
  const caseMissedOnly = getWorkbenchVisibleTrades({
    trades: [liveMissed, paperMissed, caseMissed, liveWin],
    filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: '?caseType=missed',
  })

  assert(
    missed.length === 1 && missed[0]?.id === liveMissed.id,
    '错过机会必须只含实盘错过，排除案例与模拟',
  )
  assert(
    sidebarMissed.length === 1 && sidebarMissed[0]?.id === liveMissed.id,
    '侧栏错过计数必须与交易日志实盘域一致',
  )
  assert(
    !missed.some((item) => item.tradeKind === 'case'),
    '交易日志错过视图不得混入案例',
  )
  assert(
    paperMissedOnly.length === 1 && paperMissedOnly[0]?.id === paperMissed.id,
    '模拟错过机会必须留在模拟工作区',
  )
  assert(
    caseMissedOnly.length === 1 && caseMissedOnly[0]?.id === caseMissed.id,
    '案例错过机会必须留在案例库工作区',
  )
}

export function testMissedOpportunityBelongsToAccountTradeDomainsOnly(): void {
  const tradeViews = getWorkspacePrimaryViews('trade')
  const paperViews = getWorkspacePrimaryViews('paper')
  const caseViews = getWorkspacePrimaryViews('case')

  assert(
    tradeViews.every((view) => view.pathname !== '/sim' && !view.pathname.startsWith('/review-cases')),
    '交易日志快捷视图不得指向模拟或案例',
  )
  assert(
    paperViews.some((view) => view.id === 'missed' && view.search === '?status=missed'),
    '模拟工作区应有独立的错过机会入口',
  )
  assert(
    !caseViews.some((view) => view.id === 'missed'),
    '案例库不得再提供错过机会入口',
  )
  assert(
    !caseViews.some((view) => view.pathname === '/missed' || view.search?.includes('caseType=missed')),
    '案例快捷视图不得保留旧错过机会语义',
  )
  assert(
    !paperViews.some((view) => view.pathname === '/missed'),
    '模拟错过不得复用交易日志 /missed 路由',
  )

  const tradeOnlyMissed = normalizeSidebarWorkspaceItems([
    {
      id: 'system:missed',
      target: { kind: 'system', id: 'missed', workspaces: ['trade'] },
      placement: 'pinned',
      order: 0,
    },
    {
      id: 'system:active',
      target: { kind: 'system', id: 'active', workspaces: ['trade', 'paper'] },
      placement: 'pinned',
      order: 1,
    },
  ])
  assert(
    getWorkspacePrimaryViews('paper', tradeOnlyMissed).some((view) => view.id === 'missed'),
    '模拟主视图必须保留本地错过机会入口，不受聚合范围影响',
  )
  assert(
    !getWorkspacePrimaryViews('case', tradeOnlyMissed).some((view) => view.id === 'missed'),
    '案例主视图不得再出现错过机会入口',
  )
  assert(
    getWorkspacePrimaryViews('paper', tradeOnlyMissed).some((view) => view.id === 'open'),
    '进行中仍对模拟开启时应保留模拟进行中视图',
  )
  assert(
    getWorkspacePrimaryViews('paper', [
      {
        id: 'system:missed',
        target: { kind: 'system', id: 'missed', workspaces: ['paper'] },
        placement: 'pinned',
        order: 0,
      },
    ]).some((view) => view.id === 'missed'),
    '对模拟开启错过能力后应出现错过机会主视图',
  )
}

export async function testQuickViewBarHonorsCapabilityVisibility(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/trades/QuickViewBar.tsx', 'utf8')
  assert(source.includes('filterViewsBySidebarCapabilities'), '快捷视图应按能力可见范围过滤')
  assert(source.includes('sidebarWorkspaceItems'), '快捷视图应读取侧栏工作区配置')
  assert(source.includes('savedViewSearch(view)'), '恢复保存视图必须使用原生阶段查询边界')
  assert(source.includes('searchParamsToRecord(searchParams)'), '保存当前视图必须使用原生阶段查询边界')
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
    '案例不受隐藏已平仓影响，侧栏有数时列表应能看见',
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
  const remainingDays = getTradeRemainingDays(stillVisible)
  assert(remainingDays !== null && remainingDays >= 1, '未满 30 天应仍有剩余天数')
  assert(!isTradeExpired(stillVisible), '未满 30 天不得 purge')
}

export function testInvalidOrFutureTrashTimestampNeverBecomesAutomaticallyPurgeable(): void {
  const invalid: Trade = { ...trade, id: 'invalid-trash-time', deletedAt: 'not-a-date' }
  const future: Trade = {
    ...trade,
    id: 'future-trash-time',
    deletedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }
  assert(getTradeRemainingDays(invalid) === null, '非法删除时间必须进入人工核对态')
  assert(getTradeRemainingDays(future) === null, '未来删除时间必须进入人工核对态')
  assert(!isTradeExpired(invalid) && !isTradeExpired(future), '异常时间不得触发任何自动永久删除')
}

export function testPermanentTradeDeleteRejectsRestoredOrNewDeletionGeneration(): void {
  const previous = useStore.getState()
  const deletedAt = '2026-07-01T00:00:00.000Z'
  try {
    useStore.setState({
      trades: [{ ...trade, id: 'generation-guard', deletedAt, deletionId: 'new-generation' }],
      weeklyReviews: [],
      starredIds: [],
      subscribedIds: [],
    })
    const stale = useStore.getState().purgeTrades([{
      id: 'generation-guard',
      expectedDeletedAt: deletedAt,
      expectedDeletionId: 'old-generation',
    }])
    assert(stale.purgedIds.length === 0 && stale.staleIds[0] === 'generation-guard', '旧确认框不得删除新一代回收站记录')
    assert(useStore.getState().trades.some((item) => item.id === 'generation-guard'), '代次冲突必须保留交易')

    useStore.getState().restoreTrade('generation-guard')
    const restored = useStore.getState().purgeTrades([{
      id: 'generation-guard',
      expectedDeletedAt: deletedAt,
      expectedDeletionId: 'new-generation',
    }])
    assert(restored.purgedIds.length === 0 && restored.notInTrashIds[0] === 'generation-guard', '恢复后的交易不得被旧确认框永久删除')
  } finally {
    useStore.setState({
      trades: previous.trades,
      weeklyReviews: previous.weeklyReviews,
      starredIds: previous.starredIds,
      subscribedIds: previous.subscribedIds,
    })
  }
}

export function testCsvRollbackRemovesOnlyTheExactImportedRecord(): void {
  const previous = useStore.getState().trades
  const imported: Trade = { ...trade, id: 'csv-rollback-exact', ref: 'TRD-CSV-ROLLBACK' }
  try {
    useStore.setState({ trades: [imported] })
    useStore.setState({ trades: [{ ...imported, symbol: '用户已修改' }] })
    const removed = useStore.getState().rollbackFailedImportedTrades([imported])
    assert(removed.length === 0, '导入后被用户修改的同 ID 记录不得由失败回滚删除')
    assert(useStore.getState().trades[0]?.symbol === '用户已修改', '失败回滚必须保留用户并发修改')
  } finally {
    useStore.setState({ trades: previous })
  }
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
  const ambiguousCase: Trade = {
    ...trade,
    id: 'ambiguous-case',
    tradeKind: 'case',
    caseType: 'ambiguous',
    reviewCategory: 'ambiguous',
  }
  const missedCase: Trade = {
    ...trade,
    id: 'missed-case',
    tradeKind: 'case',
    caseType: 'missed',
    reviewCategory: 'normal',
    status: 'missed',
  }
  const missedWithMistakeEvidence: Trade = {
    ...trade,
    id: 'missed-with-tags',
    tradeKind: 'case',
    caseType: 'missed',
    status: 'missed',
    reviewCategory: 'mistake',
    mistakeTags: ['情绪化交易', '缺乏耐心'],
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
    [focusCase, mistakeCase, ambiguousCase, missedCase, missedWithMistakeEvidence, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'mistakes' },
    [],
  )
  const missedFacet = getWorkbenchVisibleTrades({
    trades: [mistakeCase, missedCase, missedWithMistakeEvidence],
    filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    starredIds: [],
    display: DEFAULT_DISPLAY,
    search: '?caseType=missed',
  })
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
  assert(
    mistakes.length === 1 && mistakes[0]?.id === mistakeCase.id,
    'mistakes scope must exclude ambiguous and all missed cases, including those with mistake tags',
  )
  assert(
    missedFacet.length === 2 &&
      missedFacet.some((item) => item.id === missedCase.id) &&
      missedFacet.some((item) => item.id === missedWithMistakeEvidence.id),
    'caseType=missed facet must still list missed cases that carry mistake tags',
  )
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
    cashCurrency: 'USD',
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
  assert(copy.sourceNoteHtml === source.note, 'copy keeps source note snapshot')
  assert(copy.note === '', 'copy starts with an empty insight note')
  assert(!copy.deletedAt, 'copy is not deleted')
  assert(source.tradeKind === 'live', 'source trade kind is unchanged')
  assert(source.deletedAt === '2026-06-01T00:00:00.000Z', 'source deletion metadata is unchanged')

  const missedSource: Trade = {
    ...trade,
    id: 'missed-source',
    ref: 'TRD-10',
    status: 'missed',
    mistakeTags: ['犹豫未进'],
    reviewCategory: 'mistake',
  }
  const missedCopy = buildReviewCaseFromTrade(missedSource, { id: 'missed-case', ref: 'CAS-9' })
  assert(missedCopy.caseType === 'missed', '未成交来源必须提炼为错过机会案例')
  assert(missedCopy.reviewCategory === 'normal', '错过机会案例不得继承 mistake 分类')
  assert(missedCopy.mistakeTags.includes('犹豫未进'), '错过机会案例仍保留错误标签')
}

export function testGetNextReviewCaseRefUsesExistingCaseRefsOnly(): void {
  const next = getNextReviewCaseRef([
    { ...trade, ref: 'TRD-99' },
    { ...trade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    { ...trade, id: 'case-7', ref: 'CAS-7', tradeKind: 'case' },
  ])

  assert(next === 'CAS-8', 'next review case ref increments highest case ref')
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

async function buildSyntheticNotionTradeZip(): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const trades = [
    { symbol: 'BTCUSDT', image: 'btc.png' },
    { symbol: 'EURUSD', image: 'eur.png' },
    { symbol: 'XAUUSD', image: 'xau.png' },
  ] as const
  for (const [index, item] of trades.entries()) {
    zip.file(item.image, new Uint8Array([0, index, 255 - index, 17, 31]))
    zip.file(`trade-${index + 1}.md`, [
      '# Trade #',
      `Date: 2026/07/${14 + index}`,
      `Symbol: ${item.symbol}`,
      'Position: Buy',
      'Status: Closed by T/P',
      'Net PnL: US$20.00',
      '',
      `![截图](${item.image})`,
    ].join('\n'))
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

export async function testSampleNotionZipKeepsImagesAttachedToTrades(): Promise<void> {
  const zip = await buildSyntheticNotionTradeZip()
  const result = await parseNotionZip(zip, [strategy])
  const withImages = result.previews.filter((p) => p.imageCount > 0)

  assert(result.previews.length >= 3, 'synthetic Notion zip produces trade previews')
  assert(withImages.length >= 3, 'synthetic Notion zip keeps images attached to trades')
  assert(
    withImages.every((p) => p.trade.symbol),
    'image-bearing previews still have symbols',
  )
}

export async function testNotionZipUnwrapsNestedExportBlockWrapper(): Promise<void> {
  const JSZip = (await import('jszip')).default
  const inner = await buildSyntheticNotionTradeZip()
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
  let purgeCalls = 0

  const count = await cleanExpiredTradeTrash([expired, boundary, recent], (ids) => {
    purgeCalls += 1
    purged.push(...ids)
  })

  assert(count === 2, 'expired and zero-remaining boundary trades are cleaned')
  assert(purgeCalls === 1, 'expired trash cleanup must purge the full batch in one store action')
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

export function testSettingsReorderPersistsSymbolAndReviewTemplateOrder(): void {
  const previousCatalog = useStore.getState().symbolCatalog
  const previousTemplates = useStore.getState().reviewTemplates
  try {
    useStore.setState({
      symbolCatalog: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      reviewTemplates: [
        { id: 'template-a', name: '模板 A', content: '' },
        { id: 'template-b', name: '模板 B', content: '' },
        { id: 'template-c', name: '模板 C', content: '' },
      ],
    })

    useStore.getState().setSymbolCatalogOrder(['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
    useStore.getState().reorderReviewTemplates('template-c', 'template-a')

    assert(
      useStore.getState().symbolCatalog.join(',') === 'SOLUSDT,BTCUSDT,ETHUSDT',
      '品种拖拽顺序必须写回目录并供交易下拉复用',
    )
    assert(
      useStore.getState().reviewTemplates.map((template) => template.id).join(',') ===
        'template-c,template-a,template-b',
      '复盘模板拖拽顺序必须写回 store 并供起稿菜单复用',
    )
  } finally {
    useStore.setState({
      symbolCatalog: previousCatalog,
      reviewTemplates: previousTemplates,
    })
  }
}

export async function testSettingsDragSortingAvoidsNativeFloatingPreviews(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [layout, symbols, templates] = await Promise.all([
    fs.readFile('src/views/settings/SettingsLayout.tsx', 'utf8'),
    fs.readFile('src/views/settings/SymbolsPanel.tsx', 'utf8'),
    fs.readFile('src/views/settings/ReviewTemplatesPanel.tsx', 'utf8'),
  ])
  assert(
    layout.includes('draggable={false}') && layout.includes('onDragStart={(event) => event.preventDefault()}'),
    '设置导航链接必须拦截浏览器原生 file:// 拖拽预览',
  )
  assert(
    symbols.includes('hideNativeDragPreview(event.dataTransfer)') &&
      templates.includes('hideNativeDragPreview(event.dataTransfer)'),
    '品种与复盘起稿排序不得显示原生浮动缩略图',
  )
}

export function testWorkbenchCountMatchesVisibleTradesWithoutSorting(): void {
  const today = formatYmd(new Date())
  const trades: Trade[] = [
    { ...trade, id: 'open-live', status: 'open', symbol: 'EURUSD' },
    { ...trade, id: 'hidden-loss', status: 'loss', symbol: 'EURUSD' },
    { ...trade, id: 'paper-loss', status: 'loss', tradeKind: 'paper', symbol: 'EURUSD' },
    {
      ...trade,
      id: 'scoped-paper-win',
      status: 'win',
      tradeKind: 'paper',
      symbol: 'EURUSD',
      openedAt: today,
      closedAt: today,
    },
    {
      ...trade,
      id: 'mistake-case',
      tradeKind: 'case',
      reviewCategory: 'mistake',
      mistakeTags: ['追单'],
    },
    { ...trade, id: 'deleted-open', status: 'open', deletedAt: '2026-07-10T00:00:00.000Z' },
  ]
  const display = { ...DEFAULT_DISPLAY, hideClosed: true, sortBy: 'pnl' as const }
  const cases = [
    { filter: { type: 'all', tradeKind: 'live' } as const, search: '' },
    {
      filter: { type: 'all', tradeKind: 'live' } as const,
      search: '?status=loss&symbol=EURUSD',
    },
    {
      filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'mistakes' } as const,
      search: '?mistakeTag=%E8%BF%BD%E5%8D%95',
    },
    {
      filter: {
        type: 'strategy',
        strategyId: strategy.id,
        analysisScope: { kind: 'paper', range: '30d' },
      } as const,
      search: '?kind=paper&range=30d',
    },
  ]

  const expectedCounts = cases.map((entry) =>
    getWorkbenchVisibleTrades({ trades, starredIds: ['hidden-loss'], display, ...entry }).length,
  )

  const originalSort = Array.prototype.sort
  Array.prototype.sort = function () {
    throw new Error('count-only path must not sort')
  }
  try {
    for (const [index, entry] of cases.entries()) {
      const options = { trades, starredIds: ['hidden-loss'], display, ...entry }
      assert(
        countWorkbenchVisibleTrades(options) === expectedCounts[index],
        `count-only 应与 ${entry.search || '默认筛选'} 的工作台结果一致`,
      )
    }
  } finally {
    Array.prototype.sort = originalSort
  }
}

export function testBatchTradeLifecycleCommitsOnceAndUndoesAsOneAction(): void {
  const previous = useStore.getState()
  const first: Trade = { ...trade, id: 'batch-life-1', ref: 'TRD-BATCH-LIFE-1' }
  const second: Trade = { ...trade, id: 'batch-life-2', ref: 'TRD-BATCH-LIFE-2' }
  const untouched: Trade = { ...trade, id: 'batch-life-3', ref: 'TRD-BATCH-LIFE-3' }

  useStore.setState({
    trades: [first, second, untouched],
    undoStack: [],
    redoStack: [],
    starredIds: [first.id, second.id, untouched.id],
    subscribedIds: [first.id, second.id, untouched.id],
  })
  let commits = 0
  const unsubscribe = useStore.subscribe(() => {
    commits += 1
  })

  try {
    useStore.getState().removeTrades([first.id, second.id, 'missing', first.id])
    let state = useStore.getState()
    assert(commits === 1, '批量移入回收站必须只提交一次 store 更新')
    assert(
      state.trades.filter((item) => item.id !== untouched.id).every((item) => Boolean(item.deletedAt)),
      '批量移入回收站必须更新全部有效记录',
    )
    assert(!state.trades.find((item) => item.id === untouched.id)?.deletedAt, '未选记录不得被删除')
    assert(
      state.undoStack.length === 1 && state.undoStack[0]?.trades.length === 2,
      '整批删除必须形成一条包含全部记录的撤销操作',
    )

    useStore.getState().undo()
    state = useStore.getState()
    assert(
      state.trades.every((item) => !item.deletedAt),
      '一次撤销必须同时恢复整批记录',
    )
    assert(state.undoStack.length === 0, '整批撤销后不得残留同批的独立撤销步骤')

    useStore.setState({
      trades: [
        { ...first, deletedAt: '2026-07-01T00:00:00.000Z' },
        { ...second, deletedAt: '2026-07-01T00:00:00.000Z' },
        untouched,
      ],
      undoStack: [],
      redoStack: [],
    })
    commits = 0
    useStore.getState().restoreTrades([first.id, second.id, 'missing'])
    state = useStore.getState()
    assert(commits === 1, '批量恢复必须只提交一次 store 更新')
    assert(state.trades.every((item) => !item.deletedAt), '批量恢复必须恢复全部有效记录')
    assert(state.undoStack.length === 0, '批量恢复必须保持现有的不可撤销语义')

    useStore.setState({
      trades: [
        { ...first, deletedAt: '2026-07-01T00:00:00.000Z', deletionId: 'delete-first' },
        { ...second, deletedAt: '2026-07-01T00:00:00.000Z', deletionId: 'delete-second' },
        untouched,
      ],
      starredIds: [first.id, second.id, untouched.id],
      subscribedIds: [first.id, second.id, untouched.id],
    })
    commits = 0
    useStore.getState().purgeTrades([
      { id: first.id, expectedDeletedAt: '2026-07-01T00:00:00.000Z', expectedDeletionId: 'delete-first' },
      { id: second.id, expectedDeletedAt: '2026-07-01T00:00:00.000Z', expectedDeletionId: 'delete-second' },
      'missing',
    ])
    state = useStore.getState()
    assert(commits === 1, '批量彻底删除必须只提交一次 store 更新')
    assert(
      state.trades.map((item) => item.id).join(',') === untouched.id,
      '批量彻底删除必须只移除目标记录',
    )
    assert(state.starredIds.join(',') === untouched.id, '彻底删除必须同步清理星标引用')
    assert(state.subscribedIds.join(',') === untouched.id, '彻底删除必须同步清理订阅引用')
  } finally {
    unsubscribe()
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      starredIds: previous.starredIds,
      subscribedIds: previous.subscribedIds,
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

export function testUndoHistoryKeepsTheLatestFiftyMutations(): void {
  const previous = useStore.getState()
  const editable: Trade = { ...trade, id: 'undo-window', ref: 'TRD-UNDO', size: 0 }
  try {
    useStore.setState({ trades: [editable], undoStack: [], redoStack: [] })
    for (let size = 1; size <= 51; size += 1) {
      useStore.getState().updateTradeData(editable.id, { size })
    }

    assert(useStore.getState().undoStack.length === 50, '撤销历史必须保持固定 50 条容量')
    useStore.getState().undo()
    assert(useStore.getState().trades[0]?.size === 50, '撤销必须回退最近一次操作，而不是陈旧操作')
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
    })
  }
}

export function testMissingTradeDoesNotCreateInvalidUndoSnapshot(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: [], undoStack: [], redoStack: [] })
    useStore.getState().setStatus('missing', 'win')
    useStore.getState().updateTradeData('missing', { size: 2 })
    useStore.getState().removeTrade('missing')
    assert(useStore.getState().undoStack.length === 0, '不存在的记录不得污染撤销历史')
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
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
