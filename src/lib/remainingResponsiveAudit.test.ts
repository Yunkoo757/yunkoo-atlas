function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListSwitchesBeforeDesktopColumnsCanClip(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')
  assert(css.includes('@media (max-width: 1268px)'), '交易列表必须在最小桌面列宽失效前切换布局')
  assert(!css.includes('@media (max-width: 1200px)'), '1201–1268px 不得继续处于无滚动条的裁列夹缝')
}

export async function testMobileSafeAreaAndWeeklyChartFallbackAreVisible(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [html, weeklyCss] = await Promise.all([
    fs.readFile('index.html', 'utf8'),
    fs.readFile('src/views/WeeklyReviewView.css', 'utf8'),
  ])
  assert(html.includes('viewport-fit=cover'), '移动端 viewport 必须启用安全区适配')
  assert(/\.wr-chart-loading\s*\{[^}]*min-height:/s.test(weeklyCss), '周复盘图表懒加载期间必须保留可见高度')
}

export async function testPrimaryMobileBreakpointHasNoNineHundredPixelSplit(): Promise<void> {
  const fs = await import('node:fs/promises')
  const files = [
    'src/views/Dashboard.css',
    'src/views/QuickNotesView.css',
    'src/views/TodayWorkspace.css',
    'src/views/settings/ProfileSettingsPanel.css',
    'src/views/WeeklyReviewView.css',
    'src/views/settings/SymbolsPanel.css',
    'src/components/RiskStatusStrip.css',
    'src/components/WeeklyRiskPreparationCard.css',
  ]
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    assert(!/@media[^\n{]*\([^\n{]*max-width:\s*900px/.test(css), `${file} 必须与 AppFrame 的 899px 主断点一致`)
  }
}

export async function testFeatureOwnedCssClassesDoNotCollideGlobally(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [batchCss, tagCss, tagView] = await Promise.all([
    fs.readFile('src/components/ui/BatchActionBar.css', 'utf8'),
    fs.readFile('src/views/settings/TagPresetsPanel.css', 'utf8'),
    fs.readFile('src/views/settings/TagPresetsPanel.tsx', 'utf8'),
  ])
  assert(!batchCss.includes('.batch-action-btn'), '批量操作条不得与全局按钮兼容类同名')
  assert(batchCss.includes('.batch-bar-action-btn'), '批量操作条应使用组件自有类名')
  assert(!tagCss.includes('.tag-input') && !tagView.includes('className="tag-input"'), '标签预置输入框不得覆盖详情标签编辑器')
  assert(tagCss.includes('.tag-preset-input') && tagView.includes('className="tag-preset-input"'), '标签预置输入框应使用页面自有类名')
}

export async function testGlobalOverlayLayersUseNamedTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [tokens, command, hover, tooltip, toast] = await Promise.all([
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/components/CommandPalette.css', 'utf8'),
    fs.readFile('src/components/HoverPreview.css', 'utf8'),
    fs.readFile('src/components/ui/Tooltip.css', 'utf8'),
    fs.readFile('src/components/Toast.css', 'utf8'),
  ])
  for (const token of ['--z-context', '--z-modal', '--z-popover', '--z-tooltip', '--z-toast']) {
    assert(tokens.includes(token), `缺少全局层级 token：${token}`)
  }
  assert(command.includes('z-index: var(--z-modal)'), '命令面板必须高于悬浮预览')
  assert(hover.includes('z-index: var(--z-context)'), '悬浮预览必须使用上下文层级')
  assert(tooltip.includes('z-index: var(--z-tooltip)'), 'Tooltip 必须使用统一层级')
  assert(toast.includes('z-index: var(--z-toast)'), 'Toast 必须使用统一最高反馈层级')
}
