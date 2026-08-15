function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readCssRules(css: string, selector: string): string[] {
  const selectorPattern = selector.trim().split(/\s+/).map(escapeRegExp).join('\\s+')
  const matches = [...css.matchAll(new RegExp(`(?:^|[}\\r\\n])\\s*${selectorPattern}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map((match) => match[1])
}

function readCssRule(css: string, selector: string, label: string): string {
  const match = readCssRules(css, selector).at(0)
  if (!match) throw new Error(`${label} 必须保留 ${selector} 规则`)
  return match
}

function assertReadableRule(
  css: string,
  selector: string,
  expectedColor: string,
  label: string,
  allowsExistingOpacity = false,
): void {
  const rules = readCssRules(css, selector)
  assert(rules.length > 0, `${label} 必须保留 ${selector} 规则`)
  const rule = rules.find((candidate) => candidate.includes(`color: ${expectedColor};`))
  if (!rule) throw new Error(`${label} 必须使用 ${expectedColor}`)
  assert(!/var\(--text-(?:quaternary|disabled)\)/.test(rule), `${label} 不得降为四级或禁用文字`)
  if (!allowsExistingOpacity) assert(!/\bopacity\s*:/.test(rule), `${label} 不得额外降低文字不透明度`)
}

export async function testMutedTextAndGroupChevronsRemainReadable(): Promise<void> {
  const fs = await import('node:fs/promises')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')

  for (const contract of [
    '--text-primary: lch(92% 0.8 272 / 1)',
    '--text-secondary: lch(70% 1 272 / 1)',
    '--text-tertiary: lch(56% 1 272 / 1)',
    '--text-quaternary: lch(44% 1 272 / 1)',
    '--text-disabled: lch(34% 1 272 / 1)',
    '--color-text-primary: var(--text-primary)',
    '--color-text-secondary: var(--text-secondary)',
    '--color-text-tertiary: var(--text-tertiary)',
    '--color-text-quaternary: var(--text-quaternary)',
    '--color-text-disabled: var(--text-disabled)',
    '--text-body: var(--color-text-secondary)',
    '--text-muted: var(--color-text-tertiary)',
    '--list-text-secondary: var(--text-tertiary)',
    '--list-group-title: var(--text-primary)',
  ]) assert(tokens.includes(contract), `缺少已批准的桌面文字合同：${contract}`)

  for (const [role, value] of [
    ['started', 'lch(50% 7 78)'],
    ['todo', 'lch(50% 7 272)'],
    ['backlog', 'lch(50% 7 270)'],
    ['done', 'lch(50% 7 283)'],
  ]) {
    assert(tokens.includes(`--group-chevron-${role}: ${value}`), `分组折叠图标 ${role} 必须保留独立的非文字对比 token`)
  }
}

export async function testCriticalTextRolesDoNotUseLowEmphasisTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [
    weeklyReview,
    detail,
    fieldTrigger,
    tradeList,
    datePicker,
    datePickerSource,
    filterBar,
    tradeFilters,
    quickViewBar,
    tagEditor,
    shortcuts,
    select,
    button,
    sidebarWorkspace,
    sidebar,
    trash,
  ] = await Promise.all([
    fs.readFile('src/views/WeeklyReviewView.css', 'utf8'),
    fs.readFile('src/views/DetailView.css', 'utf8'),
    fs.readFile('src/components/ui/FieldTrigger.css', 'utf8'),
    fs.readFile('src/components/trades/TradeList.css', 'utf8'),
    fs.readFile('src/components/ui/DatePicker.css', 'utf8'),
    fs.readFile('src/components/ui/DatePicker.tsx', 'utf8'),
    fs.readFile('src/components/ui/FilterBar.css', 'utf8'),
    fs.readFile('src/components/trades/TradeFilters.css', 'utf8'),
    fs.readFile('src/components/trades/QuickViewBar.css', 'utf8'),
    fs.readFile('src/components/TagEditor.css', 'utf8'),
    fs.readFile('src/views/ShortcutsView.css', 'utf8'),
    fs.readFile('src/components/ui/Select.css', 'utf8'),
    fs.readFile('src/components/ui/Button.css', 'utf8'),
    fs.readFile('src/components/sidebar/SidebarWorkspace.css', 'utf8'),
    fs.readFile('src/components/Sidebar.css', 'utf8'),
    fs.readFile('src/views/TrashView.css', 'utf8'),
  ])

  assertReadableRule(weeklyReview, '.wr-score-row button', 'var(--text-secondary)', '周复盘评分交互文字')
  assertReadableRule(detail, '.dv-comment-input', 'var(--text-body)', '评论输入正文')
  assertReadableRule(fieldTrigger, '.ui-field-trigger', 'var(--text-secondary)', '字段触发器文字')
  assertReadableRule(tradeList, '.trade-row', 'var(--list-text-secondary)', '交易行辅助信息')
  assertReadableRule(tradeList, '.trade-list-group-header', 'var(--list-group-title)', '交易分组标题')
  assertReadableRule(datePicker, '.ui-date-grid button.is-outside', 'var(--text-tertiary)', '可点击的跨月日期')
  assertReadableRule(tradeFilters, '.trade-filter-head-actions button', 'var(--text-tertiary)', '筛选面板头部操作')
  assertReadableRule(quickViewBar, '.quick-view-icon', 'var(--text-tertiary)', '快捷视图图标操作')
  assertReadableRule(tagEditor, '.tag-chip-remove', 'var(--text-tertiary)', '标签移除操作', true)
  assertReadableRule(shortcuts, '.shortcuts-action', 'var(--text-tertiary)', '快捷键行操作')
  assertReadableRule(sidebarWorkspace, '.sb-workspace-overflow-manage', 'var(--text-tertiary)', '工作区管理操作')
  assertReadableRule(sidebarWorkspace, '.sb-editor-item button, .sb-editor-defaults button', 'var(--text-tertiary)', '工作区编辑操作')
  assertReadableRule(sidebar, '.sb-workspace-capability-menu', 'var(--text-tertiary)', '侧栏能力菜单操作')
  assertReadableRule(detail, '.dv-activity-toggle', 'var(--text-tertiary)', '活动记录展开操作')
  assertReadableRule(trash, '.trash-btn-purge', 'var(--text-tertiary)', '回收站彻底删除操作')
  assert(datePickerSource.includes('onClick={() => selectDate(day.value)}'), '跨月日期必须保留选日交互')
  assert(!datePickerSource.includes('disabled={!day.currentMonth}'), '跨月日期不是禁用日期，不得使用禁用文字 token')
  const disabledFieldTrigger = readCssRule(fieldTrigger, '.ui-field-trigger:disabled', '禁用日期触发器')
  assert(disabledFieldTrigger.includes('color: var(--text-disabled);'), '真正禁用的日期触发器必须使用 disabled token')
  const disabledSelect = readCssRule(select, '.ui-select-option:disabled', '禁用下拉选项')
  assert(disabledSelect.includes('color: var(--text-disabled);'), '禁用下拉选项必须使用 disabled token')
  for (const selector of [
    '.empty-btn:disabled, .csv-btn:disabled, .nim-btn:disabled',
    '.empty-btn:disabled, .csv-btn-primary:disabled, .nim-btn-primary:disabled',
  ]) {
    const rule = readCssRule(button, selector, '禁用按钮')
    assert(rule.includes('color: var(--text-disabled);'), `${selector} 必须使用 disabled token`)
  }

  const hiddenFeedDelete = readCssRule(detail, '.dv-feed-delete', '活动记录删除操作')
  assert(hiddenFeedDelete.includes('color: var(--text-tertiary);'), '活动记录删除操作默认必须使用 tertiary token')
  assert(hiddenFeedDelete.includes('opacity: 0;'), '活动记录删除操作仅允许在上下文未聚焦时隐藏')
  const feedDeleteReveal = readCssRule(
    detail,
    '.dv-feed-item-deletable:hover .dv-feed-delete, .dv-feed-item-deletable:focus-within .dv-feed-delete',
    '活动记录删除操作键盘可达性',
  )
  assert(feedDeleteReveal.includes('opacity: 1;'), '活动记录删除操作必须在 hover 与 focus-within 时显现')

  const nonCriticalQuaternaryAllowlist = [
    { css: datePicker, selector: '.ui-date-weekdays', label: '日期选择器星期标题（非交互日历上下文）' },
    { css: filterBar, selector: '.ui-filter-empty', label: '筛选器空态提示（极低强调）' },
  ]
  for (const { css, selector, label } of nonCriticalQuaternaryAllowlist) {
    const rule = readCssRule(css, selector, label)
    assert(rule.includes('color: var(--text-quaternary);'), `${label} 仅可按明确 allowlist 使用四级文字`)
    assert(!/\bopacity\s*:/.test(rule), `${label} 不得在四级文字上叠加透明度`)
  }
}

export async function testEditorPlaceholderDoesNotUndoTheReadableTextToken(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/DetailView.css', 'utf8')
  const placeholder = css.match(/\.dv-document \.editor \.ProseMirror p\.is-editor-empty:first-child::before\s*\{[^}]*\}/)?.[0] ?? ''
  assert(!placeholder.includes('opacity: 0.38'), '编辑器占位提示不得把可读颜色再次压暗到不可见')
  assert(placeholder.includes('opacity: 0.72'), '编辑器占位提示应保持清晰但低于正文')
}

export async function testWeeklyReviewScoreActionsUseInteractiveContrast(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/WeeklyReviewView.css', 'utf8')
  const scoreRule = css.match(/\.wr-score-row button\s*\{[^}]*\}/)?.[0] ?? ''
  assert(scoreRule.includes('color: var(--text-secondary)'), '周复盘评分数字必须比辅助说明更醒目')
}

export async function testCustomOverlaysCaptureAndRestoreFocus(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [shell, lightbox] = await Promise.all([
    fs.readFile('src/components/ui/ModalShell.tsx', 'utf8'),
    fs.readFile('src/components/ImageLightbox.tsx', 'utf8'),
  ])

  assert(
    shell.includes('returnFocusRef') &&
      shell.includes('document.activeElement') &&
      shell.includes('if (target?.isConnected) target.focus()'),
    '共享弹层必须捕获并恢复打开前焦点',
  )
  assert(shell.includes('focusableElements(panel)'), '共享弹层必须维护焦点陷阱')
  assert(lightbox.includes('previousFocusRef.current?.focus()'), '图片预览关闭后必须归还焦点')
  assert(lightbox.includes("if (event.key !== 'Tab') return"), '图片预览必须把 Tab 限制在模态浮层内')
}
