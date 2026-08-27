function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

import { collectLimitedCommandMatches } from './commandPaletteSearch'

export function testCommandPaletteFiltersBeforeProjectingCappedResults(): void {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    label: `交易 ${index}`,
  }))
  let projected = 0

  const result = collectLimitedCommandMatches(
    candidates,
    '交易',
    (candidate) => [candidate.label],
    (candidate) => {
      projected += 1
      return candidate.id
    },
    12,
  )

  assert(result.total === 100, '命令面板应保留总匹配数用于截断提示')
  assert(result.items.length === 12, '命令面板搜索结果应遵守明确上限')
  assert(projected === 12, '命令面板应先过滤和截断，再创建命令对象')

  const empty = collectLimitedCommandMatches(
    candidates,
    '   ',
    (candidate) => [candidate.label],
    (candidate) => {
      projected += 1
      return candidate.id
    },
    12,
  )
  assert(empty.total === 0 && empty.items.length === 0, '空查询不得构造动态搜索结果')
  assert(projected === 12, '空查询不得投影任何动态命令')
}

export async function testCommandPaletteUsesActiveWorkspaceTagFilters(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/CommandPalette.tsx', 'utf8')

  const closedGate = source.indexOf('if (!open) return null')
  const mountedDialog = source.indexOf('function CommandPaletteDialog')
  const storeSubscription = source.indexOf('useStore((s) => s.trades)')
  assert(
    closedGate >= 0 && closedGate < mountedDialog && mountedDialog < storeSubscription,
    '命令面板关闭时不得挂载 store 订阅或构造动态命令',
  )
  assert(
    source.includes('const MAX_SEARCH_RESULTS = 60'),
    '命令面板动态搜索应设置明确的全局结果上限',
  )

  assert(
    source.includes('trades.filter((trade) => !trade.deletedAt)'),
    '命令面板不得搜索回收站记录',
  )
  for (const route of ["path: '/list'", "path: '/sim'", "path: '/review-cases'"]) {
    assert(source.includes(route), `标签命令缺少工作区路由：${route}`)
  }
  assert(
    source.includes('new URLSearchParams({ tag }).toString()'),
    '标签命令应通过 URL 筛选进入对应工作区',
  )
  assert(
    !source.includes('run: first ? go(tradeDetailPath(first))'),
    '标签命令不得再打开任意第一条记录',
  )
}

export async function testSmallInteractionCopyAndContrastContracts(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [menu, actions, display, profileCss, tokens] = await Promise.all([
    fs.readFile('src/lib/tradeMenu.tsx', 'utf8'),
    fs.readFile('src/shortcuts/actions.ts', 'utf8'),
    fs.readFile('src/views/settings/DisplaySettingsPanel.tsx', 'utf8'),
    fs.readFile('src/views/settings/ProfileSettingsPanel.css', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
  ])

  assert(!menu.includes("hint: 'E'"), '未实现的编辑快捷键不得出现在右键菜单')
  assert(actions.includes("label: '上一条记录'"), '上一条动作应使用通用记录文案')
  assert(actions.includes("label: '下一条记录'"), '下一条动作应使用通用记录文案')
  assert(!actions.includes("label: '上一个案例'"), '交易详情不得继续使用案例专属文案')
  assert(display.includes('顶栏「显示」与此处共用同一组偏好'), '显示设置应说明真实持久化边界')
  assert(!display.includes('临时调整当前视图'), '显示设置不得暗示修改仅临时生效')
  assert(
    profileCss.includes('.profile-avatar-item.is-selected .profile-avatar-label') &&
      profileCss.includes('color: var(--text-primary);'),
    '选中头像标签应使用足够对比度',
  )

  const inter = tokens.indexOf('"Inter Variable"')
  const bundledCjk = tokens.indexOf('"Noto Sans SC Variable"', inter)
  const macCjk = tokens.indexOf('"PingFang SC"', bundledCjk)
  const windowsCjk = tokens.indexOf('"Microsoft YaHei UI"', macCjk)
  const system = tokens.indexOf('system-ui', windowsCjk)
  assert(
    inter >= 0 && bundledCjk > inter && macCjk > bundledCjk && windowsCjk > macCjk && system > windowsCjk,
    '字体栈应依次使用 Inter、内置 Noto Sans SC、macOS/Windows 显式回退与 system-ui',
  )
}

export async function testConfirmationsUseTheSharedModalLanguage(): Promise<void> {
  const fs = await import('node:fs/promises')
  const sources = await Promise.all([
    fs.readFile('src/components/DataIOContent.tsx', 'utf8'),
    fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8'),
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
    fs.readFile('src/views/ReviewSessionView.tsx', 'utf8'),
  ])

  assert(
    sources.every((source) => !source.includes('window.confirm')),
    '资料库、备份、复盘追记和随机复盘范围确认不得退回系统原生弹窗',
  )
  assert(
    sources.every((source) => source.includes('ModalShell')),
    '资料库、备份、复盘追记和随机复盘范围确认应复用统一弹窗语汇',
  )
}

export async function testPrimaryIconActionsUseTheSharedTooltipLanguage(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [
    quickNotes,
    lightbox,
    saveStatus,
    tradeRow,
    tradeList,
    symbolIcon,
    strategyHeader,
    detailView,
    displayMenu,
  ] = await Promise.all([
    fs.readFile('src/views/QuickNotesView.tsx', 'utf8'),
    fs.readFile('src/components/ImageLightbox.tsx', 'utf8'),
    fs.readFile('src/components/SaveStatusIndicator.tsx', 'utf8'),
    fs.readFile('src/components/trades/TradeRow.tsx', 'utf8'),
    fs.readFile('src/components/trades/TradeList.tsx', 'utf8'),
    fs.readFile('src/components/SymbolIcon.tsx', 'utf8'),
    fs.readFile('src/components/StrategyHeader.tsx', 'utf8'),
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
    fs.readFile('src/components/DisplayMenu.tsx', 'utf8'),
  ])

  assert(
    [lightbox, tradeRow, tradeList].every((source) => source.includes('Tooltip')) &&
      saveStatus.includes('InlineStatus'),
    '主要图标操作应复用统一 Tooltip，而不是浏览器原生提示',
  )
  assert(
    !quickNotes.includes('Tooltip') &&
      !quickNotes.includes("title={selectedNote.pinned") &&
      !quickNotes.includes('title="删除随记"') &&
      quickNotes.includes('aria-label={selectedNote.pinned') &&
      quickNotes.includes('aria-label="删除随记"') &&
      !displayMenu.includes('Tooltip') &&
      !displayMenu.includes('title=') &&
      displayMenu.includes('aria-label="显示选项"') &&
      !lightbox.includes('title={closeShortcut') &&
      !lightbox.includes('title={previousShortcut') &&
      !lightbox.includes('title={nextShortcut') &&
      !lightbox.includes('title={resetShortcut') &&
      !lightbox.includes('title="源像素与屏幕物理像素 1:1"') &&
      !saveStatus.includes('title={`保存失败') &&
      !saveStatus.includes('title="打开数据与备份设置"') &&
      !tradeRow.includes('title={`波段级别') &&
      tradeList.includes('<Tooltip') &&
      tradeList.includes('在本组新建') &&
      !symbolIcon.includes('title={label}') &&
      !strategyHeader.includes('title={pnlCoverage') &&
      !strategyHeader.includes('title={rCoverage') &&
      !detailView.includes('title={trade.reviewedAt') &&
      !detailView.includes("title={masked ? '直播模式下") &&
      !detailView.includes('title={\n                    reviewSubmitting'),
    '主要图标操作不得残留原生 title 提示；有可见文字的控件可不包 Tooltip',
  )
}

export async function testTodayNavigationAndDateBoundaryRemainInsideTheWorkspace(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [today, visibleTrades, dashboard, strategyHeader] = await Promise.all([
    fs.readFile('src/views/TodayWorkspace.tsx', 'utf8'),
    fs.readFile('src/hooks/useWorkbenchVisibleTrades.ts', 'utf8'),
    fs.readFile('src/views/Dashboard.tsx', 'utf8'),
    fs.readFile('src/components/StrategyHeader.tsx', 'utf8'),
  ])

  assert(!today.includes('href={`#today-'), 'HashRouter 页面不得用 URL hash 承载页内滚动')
  assert(today.includes('scrollIntoView'), 'Today 概览应在当前工作区内滚动到目标队列')
  assert(today.includes('useLocalDateKey()'), 'Today 工作台应在交易日边界后自动换日')
  assert(
    visibleTrades.includes('useBusinessDateAnchor()') && visibleTrades.includes('localDateKey,'),
    '工作台列表的今日筛选必须随交易日边界重新计算',
  )
  assert(
    dashboard.includes('useBusinessDateAnchor()') && dashboard.includes('localDateKey,'),
    '仪表盘日期范围必须在交易日边界后重新计算',
  )
  assert(
    strategyHeader.includes('useBusinessDateAnchor()') && strategyHeader.includes('localDateKey,'),
    '策略分析头部必须与列表在交易日边界后同步换日',
  )
}

export async function testRestoresAndDesktopControlsPreserveSafeInteractionState(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [dataIO, dashboard, dashboardCss, quickView, appFrame, dataSettings] =
    await Promise.all([
      fs.readFile('src/components/DataIOContent.tsx', 'utf8'),
      fs.readFile('src/views/Dashboard.tsx', 'utf8'),
      fs.readFile('src/views/Dashboard.css', 'utf8'),
      fs.readFile('src/components/trades/QuickViewBar.tsx', 'utf8'),
      fs.readFile('src/components/ui/AppFrame.css', 'utf8'),
      fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8'),
    ])

  const electronRestore = dataIO.slice(dataIO.indexOf('const onImportZip'))
  assert(
    electronRestore.indexOf('setDupGroups(null)') < electronRestore.indexOf("toast('资料库已恢复')"),
    'Electron 整库恢复后必须在展示成功状态前清除旧重复扫描结果',
  )
  assert(electronRestore.includes('onLibraryChanged?.()'), 'Electron 整库恢复后必须刷新资料库派生状态')
  assert(
    dataIO.includes("'笔记原图保存在浏览器 IndexedDB 的同一资料库中。'") &&
      dataIO.includes('随机复盘的当前轮次只保留在此标签页'),
    'Web 保存边界不得继续显示 Electron 文件夹语义，并应说明会话不进入归档',
  )
  assert(
    dashboard.includes('className="db-empty"') && /\.db-empty\s*\{[^}]*height:\s*auto;/s.test(dashboardCss),
    '仪表盘空态必须脱离通用 100% 高度，避免主操作被桌面窗口裁切',
  )
  assert(
    quickView.includes("['ArrowLeft', 'ArrowRight', 'Home', 'End']") &&
      quickView.includes('tabIndex={active'),
    '快速视图 tablist 必须支持方向键与 roving tabindex',
  )
  assert(
    appFrame.includes('--app-sidebar-width: 208px') &&
      !appFrame.includes('ui-mobile-navigation') &&
      !appFrame.includes('safe-area-inset'),
    '紧凑桌面壳层必须保留侧栏，并移除移动导航与安全区补偿',
  )
  assert(!dataSettings.includes('建议启用列表虚拟化'), '已启用虚拟列表时不得继续展示失真的性能建议')
}

export async function testResultConflictsAndReviewShortcutsHaveDedicatedRecoveryStates(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [detail, review] = await Promise.all([
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
    fs.readFile('src/views/ReviewSessionView.tsx', 'utf8'),
  ])

  assert(
    detail.includes("const hasResultConflict = needsResult && truth.hasConflict") &&
      detail.includes('交易结果存在冲突') &&
      detail.includes('修正结果'),
    '详情必须把结果冲突与字段缺失分开，并提供准确的修正动作',
  )
  assert(
    review.includes('data-review-session-focus') &&
      review.includes("? '[data-review-session-focus]'") &&
      review.includes('data-review-session-finished-focus'),
    '随机复盘评估/换条后必须把焦点留在可连续接收快捷键的容器',
  )
  assert(
    review.includes('const rTone = metricTone(trade.rMultiple)') &&
      review.includes('const rawPnlTone = metricTone(trade.pnl)') &&
      review.includes("const pnlTone = privacyMode ? 'zero' : rawPnlTone"),
    '冲突结果的 PnL 与 R 必须分别着色，不能互相覆盖语义',
  )
}

export async function testDesktopShellDashboardAndSavedViewsRemainOperable(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [sidebar, batchCss, toolbar, dashboard, segmentedControl, quickView, toastSource, toastCss, emptyState] = await Promise.all([
    fs.readFile('src/components/Sidebar.tsx', 'utf8'),
    fs.readFile('src/components/ui/BatchActionBar.css', 'utf8'),
    fs.readFile('src/components/ui/Toolbar.tsx', 'utf8'),
    fs.readFile('src/views/Dashboard.tsx', 'utf8'),
    fs.readFile('src/components/ui/SegmentedControl.tsx', 'utf8'),
    fs.readFile('src/components/trades/QuickViewBar.tsx', 'utf8'),
    fs.readFile('src/lib/toast.ts', 'utf8'),
    fs.readFile('src/components/Toast.css', 'utf8'),
    fs.readFile('src/components/EmptyState.tsx', 'utf8'),
  ])

  assert(
    sidebar.includes("type SidebarDensity = 'standard' | 'compact'") &&
      sidebar.includes('data-density={density}'),
    '桌面侧栏必须公开标准与紧凑密度状态',
  )
  assert(
    !batchCss.includes('safe-area-inset') &&
      toolbar.includes('label="更多操作"') &&
      toolbar.includes("align=\"right\""),
    '桌面批量操作不得保留移动底栏补偿，工具栏溢出动作必须可达',
  )
  assert(
    dashboard.includes('<SegmentedControl') &&
      dashboard.includes('label="统计周期"') &&
      segmentedControl.includes('role="group"') &&
      segmentedControl.includes('aria-pressed={selected}') &&
      !dashboard.includes('role="tablist"') &&
      dashboard.includes('db-chart-data'),
    '仪表盘范围按钮应使用真实筛选语义，并为图表提供键盘数据入口',
  )
  assert(
    dashboard.includes("value={stats.evaluatedCount === 0 ? '—' : String(stats.winCount)}"),
    '仪表盘没有有效结果时，盈利笔数必须显示缺失态而不是伪装成 0',
  )
  assert(
    quickView.includes("label: '撤销'") &&
      quickView.includes('saveTradeView(view)') &&
      toastSource.includes('actionLabel'),
    '删除保存视图必须提供可操作的撤销反馈',
  )
  assert(
    toastCss.includes('.toast-host') &&
      toastCss.includes('.toast-panel') &&
      toastCss.includes('@keyframes toastIn') &&
      !/\.toast-host\s*\{[^}]*transform:/s.test(toastCss),
    'toast 定位层不得再用 transform，避免入场动画叠影',
  )
  assert(
    emptyState.includes('<h2 className="empty-title">') && emptyState.includes('aria-live="polite"'),
    '空状态必须提供标题层级与动态状态播报',
  )
}

export async function testBackupPreviewDuplicateScanAndImageLimitsStayTruthful(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [dataIO, editor, composer, archiveContract] = await Promise.all([
    fs.readFile('src/components/DataIOContent.tsx', 'utf8'),
    fs.readFile('src/editor/Editor.tsx', 'utf8'),
    fs.readFile('src/components/TradeComposer.tsx', 'utf8'),
    fs.readFile('src/lib/webJournalArchiveContract.ts', 'utf8'),
  ])

  assert(
    dataIO.includes('<dt>标签设置</dt>') &&
      dataIO.includes('<dt>工作区设置</dt>') &&
      dataIO.includes('pinnedStrategyCount') &&
      dataIO.includes('symbolCatalogCount'),
    '完整恢复确认必须展示将被覆盖的设置范围',
  )
  assert(
    dataIO.includes('duplicateScanTradesRef.current !== useStore.getState().trades') &&
      dataIO.includes('交易库已变化，请重新扫描重复项'),
    '重复扫描结果必须在资料库变化后失效，不能清理陈旧记录集合',
  )
  assert(
    archiveContract.includes('MAX_WEB_JOURNAL_ENTRY_BYTES = 32 * 1024 * 1024') &&
      editor.includes('file.size > MAX_WEB_JOURNAL_ENTRY_BYTES') &&
      composer.includes('file.size > MAX_WEB_JOURNAL_ENTRY_BYTES'),
    '图片入口必须与完整备份的单附件上限保持一致',
  )
}
