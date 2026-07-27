function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListKeepsReferencesReadableAndHidesMobileSelectionChromeUntilRequested(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [css, listSource] = await Promise.all([
    fs.readFile('src/components/trades/TradeList.css', 'utf8'),
    fs.readFile('src/components/trades/TradeList.tsx', 'utf8'),
  ])

  assert(css.includes('--trade-ref-column: 72px'), '桌面交易编号列必须始终容纳完整 ref')
  assert(listSource.includes("selectionMode || selectedIds.size > 0 ? ' is-selection-mode' : ''"), '交易列表必须暴露明确的选择模式状态')
  assert(
    /@media \(max-width: 899px\), \(pointer: coarse\)[\s\S]*?\.trade-row-check,[\s\S]*?opacity:\s*0/.test(css),
    '移动端未进入选择模式时不得常驻复选框',
  )
  assert(css.includes('.trade-list.is-selection-mode .trade-row-check'), '选择模式下必须重新显示复选框')
  assert(css.includes('.trade-row-star.is-starred'), '已收藏状态必须始终可见')
}

export async function testAppUsesOneMainLandmarkAndOffersSkipNavigation(): Promise<void> {
  const fs = await import('node:fs/promises')
  const files = [
    'src/components/trades/TradeDetailLayout.tsx',
    'src/views/QuickNotesView.tsx',
    'src/views/WeeklyReviewView.tsx',
    'src/views/ReviewSessionView.tsx',
  ]
  const [frame, sidebar, ...nestedSources] = await Promise.all([
    fs.readFile('src/components/ui/AppFrame.tsx', 'utf8'),
    fs.readFile('src/components/Sidebar.tsx', 'utf8'),
    ...files.map((file) => fs.readFile(file, 'utf8')),
  ])

  assert(frame.includes('className="skip-link"'), '应用框架必须提供跳到主内容链接')
  assert(frame.includes('href="#main-content"'), 'skip link 必须指向唯一主内容')
  assert(frame.includes('<main id="main-content"'), '顶层主内容必须有稳定锚点')
  for (const [index, source] of nestedSources.entries()) {
    assert(!source.includes('<main'), `${files[index]} 不得嵌套第二个 main landmark`)
  }
  assert(sidebar.includes('<nav') && !sidebar.includes('<aside className={\'sidebar\''), '主导航必须使用 nav landmark')
}

export async function testBoardCardsAreKeyboardOperable(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/BoardView.tsx', 'utf8')
  const card = source.slice(source.indexOf('<article'), source.indexOf('<div className="bd-card-top"'))

  assert(card.includes('role="button"'), '看板卡片必须向辅助技术暴露为按钮')
  assert(card.includes('tabIndex={0}'), '看板卡片必须可通过 Tab 到达')
  assert(card.includes('onKeyDown='), '看板卡片必须支持 Enter 与 Space 打开')
}

export async function testReducedMotionLoadingIndicatorsDoNotFreezeAsSpinners(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [indicator, globalCss, detailCss, lightboxCss] = await Promise.all([
    fs.readFile('src/icons/LoadingIndicator.tsx', 'utf8'),
    fs.readFile('src/styles/global.css', 'utf8'),
    fs.readFile('src/views/DetailView.css', 'utf8'),
    fs.readFile('src/components/ImageLightbox.css', 'utf8'),
  ])
  assert(indicator.includes('loading-indicator-motion'), '通用加载图标必须区分旋转态与静态态')
  assert(indicator.includes('loading-indicator-static'), '通用加载图标必须提供 reduced-motion 静态替代')
  assert(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.loading-indicator-motion[\s\S]*?display:\s*none/.test(globalCss),
    'reduced-motion 下必须隐藏持续旋转的通用加载图标',
  )
  for (const [name, css] of [['detail', detailCss], ['lightbox', lightboxCss]] as const) {
    assert(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none/.test(css),
      `${name} 加载指示器必须在 reduced-motion 下使用明确静态状态`,
    )
  }
}

export async function testSafeAreasCoverPortraitAndLandscapeInsets(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [frameCss, navigationCss] = await Promise.all([
    fs.readFile('src/components/ui/AppFrame.css', 'utf8'),
    fs.readFile('src/components/MobileNavigation.css', 'utf8'),
  ])
  for (const inset of ['safe-area-inset-left', 'safe-area-inset-right']) {
    assert(frameCss.includes(inset), `主内容缺少横屏安全区 ${inset}`)
    assert(navigationCss.includes(inset), `移动导航缺少横屏安全区 ${inset}`)
  }
}

export async function testPrimaryControlsExposePressedDisabledAndCoarsePointerStates(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [buttonCss, menuCss, contextCss, selectCss] = await Promise.all([
    fs.readFile('src/components/ui/Button.css', 'utf8'),
    fs.readFile('src/components/Menu.css', 'utf8'),
    fs.readFile('src/components/ContextMenu.css', 'utf8'),
    fs.readFile('src/components/ui/Select.css', 'utf8'),
  ])

  assert(buttonCss.includes('.ui-btn:active:not(:disabled)'), '全局按钮必须提供按下反馈')
  assert(menuCss.includes('.menu-item:active:not(:disabled)'), '菜单项必须提供按下反馈')
  assert(contextCss.includes('.ctx-item:active:not(:disabled)'), '上下文菜单项必须提供按下反馈')
  assert(selectCss.includes('.ui-select-option:active:not(:disabled)'), '下拉选项必须提供按下反馈')
  for (const [name, css] of [['menu', menuCss], ['context', contextCss], ['select', selectCss]] as const) {
    assert(css.includes('cursor: not-allowed'), `${name} 禁用态必须明确不可操作`)
    assert(
      /@media \(max-width: 899px\), \(pointer: coarse\)[\s\S]*?min-height:\s*44px/.test(css),
      `${name} 必须为粗指针提供至少 44px 触摸目标`,
    )
  }
}

export async function testStrategyPerformanceKeepsDataMoreProminentThanDecoration(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [source, css] = await Promise.all([
    fs.readFile('src/views/Dashboard.tsx', 'utf8'),
    fs.readFile('src/views/Dashboard.css', 'utf8'),
  ])
  assert(source.includes('transform: `scaleX('), '策略条必须用 transform 表达比例，避免布局动画')
  assert(!css.includes('transition: width var(--dur-slow)'), '策略条不得动画 width')
  assert(css.includes('max-width: 240px'), '策略条必须限制装饰宽度，把空间还给统计信息')
  assert(/@media \(max-width: 899px\)[\s\S]*?\.db-strat-bar\s*\{[\s\S]*?display:\s*none/.test(css), '窄屏应直接收起装饰条，保留名称、统计和盈亏')
}
