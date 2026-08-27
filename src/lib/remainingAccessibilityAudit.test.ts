import postcss, { type Root, type Rule } from 'postcss'
import fs from 'node:fs/promises'
import path from 'node:path'

type CssSheet = { path: string; root: Root }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim()
}

async function readCss(path: string): Promise<CssSheet> {
  return { path, root: postcss.parse(await fs.readFile(path, 'utf8'), { from: path }) }
}

function findRules(sheet: CssSheet, selector: string): Rule[] {
  const expected = normalizeSelector(selector)
  const rules: Rule[] = []
  sheet.root.walkRules((rule) => {
    if (normalizeSelector(rule.selector) === expected) rules.push(rule)
  })
  assert(rules.length > 0, `${sheet.path} 必须保留 ${selector} 规则`)
  return rules
}

function declaration(rule: Rule, property: string): string | undefined {
  let value: string | undefined
  rule.walkDecls(property, (decl) => { value = decl.value.trim() })
  return value
}

function rootDeclaration(sheet: CssSheet, property: string): string | undefined {
  let value: string | undefined
  sheet.root.walkRules(':root', (rule) => { value ??= declaration(rule, property) })
  return value
}

function assertInteractiveColor(sheet: CssSheet, selector: string, expectedColor: string, label: string, contextRevealed = false): void {
  const rules = findRules(sheet, selector)
  const colors = rules.map((rule) => declaration(rule, 'color')).filter((value): value is string => Boolean(value))
  assert(colors.includes(expectedColor), `${label} 必须使用 ${expectedColor}`)
  assert(!colors.some((value) => value === 'var(--text-quaternary)' || value === 'var(--text-disabled)'), `${label} 不得使用四级或禁用文字`)
  for (const rule of rules) {
    const opacity = declaration(rule, 'opacity')
    assert(contextRevealed || opacity === undefined || opacity === '1', `${label} 不得常驻降低不透明度`)
  }
}

function assertDisabledColor(sheet: CssSheet, selector: string, label: string): void {
  const rules = findRules(sheet, selector)
  assert(rules.some((rule) => declaration(rule, 'color') === 'var(--text-disabled)'), `${label} 必须使用 disabled token`)
}

function assertContextReveal(sheet: CssSheet, hiddenSelector: string, revealSelector: string, label: string): void {
  assert(findRules(sheet, hiddenSelector).some((rule) => declaration(rule, 'opacity') === '0'), `${label} 必须明确在上下文外隐藏`)
  assert(findRules(sheet, revealSelector).some((rule) => declaration(rule, 'opacity') === '1'), `${label} 必须具备 hover 或键盘焦点显现路径`)
}

type InventoryEntry = { path: string; selector: string; property: 'color' | 'fill' | 'stroke'; role: 'decoration' | 'edge metadata' }

function allow(path: string, role: InventoryEntry['role'], property: InventoryEntry['property'], selectors: string[]): InventoryEntry[] {
  return selectors.map((selector) => ({ path, selector: normalizeSelector(selector), property, role }))
}

function inventoryKey(entry: Pick<InventoryEntry, 'path' | 'selector' | 'property'>): string {
  return `${entry.path}::${entry.selector}::${entry.property}`
}

async function walkCssFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkCssFiles(candidate))
    else if (entry.name.endsWith('.css')) files.push(candidate)
  }
  return files
}

function quaternaryInventory(sheets: CssSheet[]): InventoryEntry[] {
  const entries: InventoryEntry[] = []
  for (const sheet of sheets) {
    sheet.root.walkRules((rule) => {
      rule.walkDecls((decl) => {
        if ((decl.prop === 'color' || decl.prop === 'fill' || decl.prop === 'stroke') && decl.value.trim() === 'var(--text-quaternary)') {
          entries.push({ path: sheet.path.replace(/\\/g, '/'), selector: normalizeSelector(rule.selector), property: decl.prop, role: 'edge metadata' })
        }
      })
    })
  }
  return entries
}

function assertExactQuaternaryInventory(sheets: CssSheet[], allowlist: InventoryEntry[]): void {
  for (const item of allowlist) assert(item.role === 'decoration' || item.role === 'edge metadata', `${item.selector} 必须声明四级文字的非交互角色`)
  const actual = quaternaryInventory(sheets).map(inventoryKey).sort()
  const expected = allowlist.map(inventoryKey).sort()
  assert(actual.join('\n') === expected.join('\n'), `四级文字声明清单不封闭：\n实际 ${actual.join('\n')}\n允许 ${expected.join('\n')}`)
}

function assertDisabledRulesUseDisabledToken(sheets: CssSheet[]): void {
  for (const sheet of sheets) {
    sheet.root.walkRules((rule) => {
      const selector = rule.selector.replace(/:not\(:disabled\)/g, '')
      if (!selector.includes(':disabled') && !selector.includes('[aria-disabled')) return
      const color = declaration(rule, 'color')
      assert(color !== 'var(--text-quaternary)', `${sheet.path} ${rule.selector} 的禁用态不得使用四级文字`)
      assert(color === 'var(--text-disabled)', `${sheet.path} ${rule.selector} 的禁用态必须显式使用 disabled token`)
    })
  }
}

export async function testMutedTextAndGroupChevronsRemainReadable(): Promise<void> {
  const tokens = await readCss('src/styles/tokens.css')
  for (const [property, value] of [
    ['--text-primary', 'lch(92% 0.8 272 / 1)'], ['--text-secondary', 'lch(70% 1 272 / 1)'],
    ['--text-tertiary', 'lch(56% 1 272 / 1)'], ['--text-quaternary', 'lch(44% 1 272 / 1)'],
    ['--text-disabled', 'lch(34% 1 272 / 1)'], ['--color-text-primary', 'var(--text-primary)'],
    ['--color-text-secondary', 'var(--text-secondary)'], ['--color-text-tertiary', 'var(--text-tertiary)'],
    ['--color-text-quaternary', 'var(--text-quaternary)'], ['--color-text-disabled', 'var(--text-disabled)'],
    ['--text-body', 'var(--color-text-secondary)'], ['--text-muted', 'var(--color-text-tertiary)'],
    ['--text-list-secondary', 'lch(64% 1 272 / 1)'],
    ['--list-text-secondary', 'var(--text-list-secondary)'], ['--list-group-title', 'var(--text-primary)'],
    ['--group-chevron-started', 'lch(50% 7 78)'], ['--group-chevron-todo', 'lch(50% 7 272)'],
    ['--group-chevron-backlog', 'lch(50% 7 270)'], ['--group-chevron-done', 'lch(50% 7 283)'],
  ]) assert(rootDeclaration(tokens, property) === value, `缺少已批准的桌面文字合同：${property}`)
}

export async function testInteractiveAndDisabledTextRolesUseAccessibleTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [weeklyReview, detail, fieldTrigger, tradeList, datePicker, filterBar, tradeFilters, quickViewBar, tagEditor, shortcuts, select, button, sidebarWorkspace, sidebar, trash, notionImport, editor, tagPresets, reviewTemplates, global, symbols, riskManagement, riskRepair] = await Promise.all([
    readCss('src/views/WeeklyReviewView.css'), readCss('src/views/DetailView.css'), readCss('src/components/ui/FieldTrigger.css'), readCss('src/components/trades/TradeList.css'), readCss('src/components/ui/DatePicker.css'), readCss('src/components/ui/FilterBar.css'), readCss('src/components/trades/TradeFilters.css'), readCss('src/components/trades/QuickViewBar.css'), readCss('src/components/TagEditor.css'), readCss('src/views/ShortcutsView.css'), readCss('src/components/ui/Select.css'), readCss('src/components/ui/Button.css'), readCss('src/components/sidebar/SidebarWorkspace.css'), readCss('src/components/Sidebar.css'), readCss('src/views/TrashView.css'), readCss('src/components/NotionImportModal.css'), readCss('src/editor/Editor.css'), readCss('src/views/settings/TagPresetsPanel.css'), readCss('src/views/settings/ReviewTemplatesPanel.css'), readCss('src/styles/global.css'), readCss('src/views/settings/SymbolsPanel.css'), readCss('src/views/settings/RiskManagementSettingsPanel.css'), readCss('src/views/settings/RiskDataRepairView.css'),
  ])

  for (const [sheet, selector, color, label] of [
    [weeklyReview, '.wr-score-row button', 'var(--text-secondary)', '周复盘评分交互文字'], [detail, '.dv-comment-input', 'var(--text-body)', '评论输入正文'], [fieldTrigger, '.ui-field-trigger', 'var(--text-secondary)', '字段触发器文字'], [tradeList, '.trade-row', 'var(--list-text-secondary)', '交易行辅助信息'], [tradeList, '.trade-list-group-header', 'var(--list-group-title)', '交易分组标题'], [datePicker, '.ui-date-grid button.is-outside', 'var(--text-tertiary)', '可点击的跨月日期'], [tradeFilters, '.trade-filter-head-actions button', 'var(--text-tertiary)', '筛选面板头部操作'], [quickViewBar, '.quick-view-icon', 'var(--text-tertiary)', '快捷视图图标操作'], [tagEditor, '.tag-chip-remove', 'var(--text-tertiary)', '标签移除操作'], [shortcuts, '.shortcuts-action', 'var(--text-tertiary)', '快捷键行操作'], [sidebarWorkspace, '.sb-workspace-overflow-manage', 'var(--text-tertiary)', '工作区管理操作'], [sidebarWorkspace, '.sb-editor-item button, .sb-editor-defaults button', 'var(--text-tertiary)', '工作区编辑操作'], [sidebar, '.sb-workspace-capability-menu', 'var(--text-tertiary)', '侧栏能力菜单操作'], [detail, '.dv-activity-toggle', 'var(--text-tertiary)', '活动记录展开操作'], [trash, '.trash-btn-purge', 'var(--text-tertiary)', '回收站彻底删除操作'], [notionImport, '.nim-import-target-options button', 'var(--text-tertiary)', 'Notion 导入目标单选操作'], [editor, '.editor-review-tools button', 'var(--text-tertiary)', '编辑器起稿操作'], [tagPresets, '.settings-tag-chip-remove', 'var(--text-tertiary)', '设置标签删除操作'], [reviewTemplates, '.review-template-delete', 'var(--text-tertiary)', '起稿模板删除操作'],
  ] as const) assertInteractiveColor(sheet, selector, color, label, selector === '.sb-workspace-capability-menu')
  assertInteractiveColor(notionImport, '.nim-import-target-options span', 'var(--text-tertiary)', 'Notion 导入目标说明')
  assertInteractiveColor(reviewTemplates, '.review-template-select svg', 'var(--text-tertiary)', '起稿模板选择图标')
  assertInteractiveColor(reviewTemplates, '.review-template-drag-handle', 'var(--text-tertiary)', '起稿模板拖拽操作')
  assertInteractiveColor(symbols, '.symbols-drag-handle', 'var(--text-tertiary)', '品种拖拽操作')
  assertInteractiveColor(riskManagement, '.risk-data-summary-status a', 'var(--text-secondary)', '风险数据摘要修复入口')
  assertInteractiveColor(detail, '.dv-feed-delete', 'var(--text-tertiary)', '活动记录删除操作', true)

  assert(findRules(riskManagement, '.risk-data-summary-status a').some((rule) => declaration(rule, 'min-height') === 'var(--control-height)'), '风险数据摘要修复入口必须保留桌面可点击高度')
  assert(findRules(riskManagement, '.risk-data-summary-status a:focus-visible').some((rule) => declaration(rule, 'outline') === 'var(--focus-ring-outline)'), '风险数据摘要修复入口必须提供键盘焦点样式')
  assert(findRules(riskRepair, '.risk-repair-action:focus-visible').some((rule) => declaration(rule, 'outline') === 'var(--focus-ring-outline)'), '修复中心动作必须提供键盘焦点样式')

  for (const [sheet, selector, label] of [
    [fieldTrigger, '.ui-field-trigger:disabled', '禁用日期触发器'], [select, '.ui-select-option:disabled', '禁用下拉选项'], [button, '.ui-btn:disabled, .dio-btn:disabled, .symbols-btn:disabled, .st-io:disabled, .st-add:disabled, .st-del-btn:disabled, .empty-btn:disabled, .csv-btn:disabled, .nim-btn:disabled, .sfm-btn:disabled, .batch-action-btn:disabled', '禁用通用按钮'], [button, '.ui-btn-primary:disabled, .dio-btn-primary:disabled, .symbols-btn-primary:disabled, .st-add:disabled, .empty-btn:disabled, .csv-btn-primary:disabled, .nim-btn-primary:disabled', '禁用主按钮'], [global, ':where(input, textarea):disabled', '禁用全局输入框'], [reviewTemplates, '.review-template-drag-handle:disabled', '禁用起稿拖拽手柄'], [symbols, '.symbols-drag-handle:disabled', '禁用品种拖拽手柄'],
  ] as const) assertDisabledColor(sheet, selector, label)

  assertContextReveal(detail, '.dv-feed-delete', '.dv-feed-item-deletable:hover .dv-feed-delete, .dv-feed-item-deletable:focus-within .dv-feed-delete', '活动记录删除操作')
  assertContextReveal(sidebar, '.sb-workspace-capability-menu', '.sb-sortable-row:hover .sb-workspace-capability-menu, .sb-sortable-row:focus-within .sb-workspace-capability-menu, .sb-sortable-row.is-capability-menu-open .sb-workspace-capability-menu', '侧栏能力菜单操作')
  assertContextReveal(shortcuts, '.shortcuts-actions', '.shortcuts-row:hover .shortcuts-actions, .shortcuts-row:focus-within .shortcuts-actions, .shortcuts-row.is-recording .shortcuts-actions', '快捷键行操作区')
  assertContextReveal(trash, '.trash-item-actions', '.trash-item:hover .trash-item-actions, .trash-item-actions:focus-within', '回收站行操作区')

  for (const [sheet, selector, label] of [[datePicker, '.ui-date-weekdays', '日期选择器星期标题']] as const) {
    assert(findRules(sheet, selector).some((rule) => declaration(rule, 'color') === 'var(--text-quaternary)'), `${label} 必须保持明确的四级文字 allowlist`)
  }
  assert(findRules(filterBar, '.ui-filter-empty').some((rule) => declaration(rule, 'color') === 'var(--text-tertiary)'), '筛选器空态提示必须使用可读的三级文字')

  const datePickerSource = await fs.readFile('src/components/ui/DatePicker.tsx', 'utf8')
  assert(datePickerSource.includes('onClick={() => selectDate(day.value)}'), '跨月日期必须保留选日交互')
  assert(!datePickerSource.includes('disabled={!day.currentMonth}'), '跨月日期不是禁用日期，不得使用禁用文字 token')
}

export async function testQuaternaryDeclarationInventoryIsClosedAndDisabledNeverUsesIt(): Promise<void> {
  const sheets = await Promise.all((await walkCssFiles('src')).map(readCss))
  const allowlist: InventoryEntry[] = [
    ...allow('src/components/ContextMenu.css', 'edge metadata', 'color', ['.ctx-item-hint']),
    ...allow('src/components/CsvImportModal.css', 'edge metadata', 'color', ['.csv-map-sample']),
    ...allow('src/components/EmptyState.css', 'decoration', 'stroke', ['.empty-art path']),
    ...allow('src/components/EmptyState.css', 'decoration', 'fill', ['.empty-art rect']),
    ...allow('src/components/RouteState.css', 'edge metadata', 'color', ['.app-route-error-detail']),
    ...allow('src/components/Sidebar.css', 'decoration', 'color', ['.sb-ws-chevron']),
    ...allow('src/components/TradeOpenRiskDialog.css', 'edge metadata', 'color', ['.trade-open-risk-periods em', '.trade-open-risk-reason small']),
    ...allow('src/components/trades/TradeList.css', 'edge metadata', 'color', ['.trade-row-more']),
    ...allow('src/components/ui/CrumbsNav.css', 'decoration', 'color', ['.crumbs-sep']),
    ...allow('src/components/ui/DatePicker.css', 'edge metadata', 'color', ['.ui-date-weekdays']),
    ...allow('src/components/ui/Toolbar.css', 'decoration', 'color', ['.ui-toolbar-sep']),
    ...allow('src/components/WeeklyRiskPreparationCard.css', 'edge metadata', 'color', ['.risk-preparation-inline-input small']),
    ...allow('src/components/WelcomeScreen.css', 'edge metadata', 'color', ['.welcome-hint']),
    ...allow('src/editor/Editor.css', 'edge metadata', 'color', ['.editor .ProseMirror p.is-editor-empty:first-child::before']),
    ...allow('src/views/Dashboard.css', 'edge metadata', 'color', ['.db-chart-tip-hint']),
    ...allow('src/views/DetailView.css', 'edge metadata', 'color', ['.dv-detail-position > span', '.dv-section-chev', '.dv-prop-empty']),
    ...allow('src/views/DetailView.css', 'decoration', 'color', ['.dv-empty-card > svg']),
    ...allow('src/views/ReviewSessionView.css', 'edge metadata', 'color', ['.review-session-card-ref']),
    ...allow('src/views/ShortcutsView.css', 'decoration', 'color', ['.shortcuts-capture.is-fixed > svg', '.shortcuts-sequence-arrow']),
    ...allow('src/views/ShortcutsView.css', 'edge metadata', 'color', ['.shortcuts-unassigned']),
    ...allow('src/views/TodayWorkspace.css', 'edge metadata', 'color', ['.today-queue-tabs strong']),
    ...allow('src/views/TrashView.css', 'edge metadata', 'color', ['.trash-search', '.trash-search-input::placeholder', '.trash-search-count', '.trash-group-count']),
  ]
  assertExactQuaternaryInventory(sheets, allowlist)
  assertDisabledRulesUseDisabledToken(sheets)
}

export async function testPostCssInventoryRejectsUnlistedInteractiveMutations(): Promise<void> {
  const illegalSelectors = ['button', 'button span', 'button svg', '.drag-handle']
  for (const selector of illegalSelectors) {
    const sheet: CssSheet = { path: 'fixture.css', root: postcss.parse(`${selector} { color: var(--text-quaternary); }`) }
    let rejected = false
    try { assertExactQuaternaryInventory([sheet], []) } catch { rejected = true }
    assert(rejected, `${selector} 的未列入交互四级文字变异必须失败`)
  }

  const commentOnly: CssSheet = { path: 'fixture.css', root: postcss.parse('/* button { color: var(--text-quaternary); } */ .edge { color: var(--text-quaternary); }') }
  assertExactQuaternaryInventory([commentOnly], allow('fixture.css', 'edge metadata', 'color', ['.edge']))

  const disabledWithoutColor: CssSheet = { path: 'fixture.css', root: postcss.parse('button:disabled { opacity: .5; }') }
  let disabledRejected = false
  try { assertDisabledRulesUseDisabledToken([disabledWithoutColor]) } catch { disabledRejected = true }
  assert(disabledRejected, '仅降低禁用按钮透明度的变异必须失败')

  const explicitDisabled: CssSheet = { path: 'fixture.css', root: postcss.parse('button:disabled { color: var(--text-disabled); opacity: .5; }') }
  assertDisabledRulesUseDisabledToken([explicitDisabled])
}

export async function testEditorPlaceholderDoesNotUndoTheReadableTextToken(): Promise<void> {
  const detail = await readCss('src/views/DetailView.css')
  const rule = findRules(detail, '.dv-document .editor .ProseMirror p.is-editor-empty:first-child::before').at(0)
  assert(rule && declaration(rule, 'opacity') === '0.72', '编辑器占位提示应保持清晰但低于正文')
}

export async function testWeeklyReviewScoreActionsUseInteractiveContrast(): Promise<void> {
  assertInteractiveColor(await readCss('src/views/WeeklyReviewView.css'), '.wr-score-row button', 'var(--text-secondary)', '周复盘评分数字')
}

export async function testCustomOverlaysCaptureAndRestoreFocus(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [shell, lightbox] = await Promise.all([fs.readFile('src/components/ui/ModalShell.tsx', 'utf8'), fs.readFile('src/components/ImageLightbox.tsx', 'utf8')])
  assert(shell.includes('returnFocusRef') && shell.includes('document.activeElement') && shell.includes('if (target?.isConnected) target.focus()'), '共享弹层必须捕获并恢复打开前焦点')
  assert(shell.includes('focusableElements(panel)'), '共享弹层必须维护焦点陷阱')
  assert(lightbox.includes('previousFocusRef.current?.focus()'), '图片预览关闭后必须归还焦点')
  assert(lightbox.includes("if (event.key !== 'Tab') return"), '图片预览必须把 Tab 限制在模态浮层内')
}
