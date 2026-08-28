function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListKeepsReferencesReadableAndRevealsSelectionChromeOnIntent(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [css, listSource] = await Promise.all([
    fs.readFile('src/components/trades/TradeList.css', 'utf8'),
    fs.readFile('src/components/trades/TradeList.tsx', 'utf8'),
  ])

  assert(css.includes('--trade-ref-column: 72px'), '桌面交易编号列必须始终容纳完整 ref')
  assert(listSource.includes("selectionMode || selectedIds.size > 0 ? ' is-selection-mode' : ''"), '交易列表必须暴露明确的选择模式状态')
  assert(/\.trade-row-check,[\s\S]*?opacity:\s*0/.test(css), '桌面列表默认必须压低选择控件噪音')
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

export async function testDesktopFrameAvoidsMobileSafeAreaDependencies(): Promise<void> {
  const fs = await import('node:fs/promises')
  const frameCss = await fs.readFile('src/components/ui/AppFrame.css', 'utf8')
  assert(
    frameCss.includes('--app-sidebar-width: 244px') &&
      frameCss.includes('--app-sidebar-width: 208px') &&
      frameCss.includes('var(--app-sidebar-width)'),
    '桌面主框架必须消费标准与紧凑侧栏宽度 token',
  )
  assert(frameCss.includes('--main-inset'), '桌面主框架必须消费窗口内缩 token')
  assert(!frameCss.includes('safe-area-inset'), '桌面主框架不得依赖移动设备安全区')
}

export async function testPrimaryControlsExposePressedDisabledAndDesktopScaleStates(): Promise<void> {
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
    assert(!css.includes('(pointer: coarse)'), `${name} 不得为桌面控件维护粗指针尺寸分支`)
  }
  assert(buttonCss.includes('.ui-btn-sm') && buttonCss.includes('var(--control-height-sm)'), '按钮必须提供 28px 紧凑档')
  assert(buttonCss.includes('.ui-btn-md') && buttonCss.includes('var(--control-height-md)'), '按钮必须提供 32px 标准档')
  assert(buttonCss.includes('.ui-btn-lg') && buttonCss.includes('var(--control-height-lg)'), '按钮必须提供 36px 强调档')
}

export async function testPersistentControlStatesRemainStrongerThanHover(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [tokens, fieldTrigger, filterBar, quickViews, sidebar, selectSource] = await Promise.all([
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/components/ui/FieldTrigger.css', 'utf8'),
    fs.readFile('src/components/ui/FilterBar.css', 'utf8'),
    fs.readFile('src/components/trades/QuickViewBar.css', 'utf8'),
    fs.readFile('src/components/Sidebar.css', 'utf8'),
    fs.readFile('src/components/ui/Select.tsx', 'utf8'),
  ])

  assert(tokens.includes('--surface-control-hover: lch(10.8% 0.9 272 / 1)'), '控件 Hover 必须使用较弱瞬态表面')
  assert(tokens.includes('--surface-control-active: lch(14.2% 0.9 272 / 1)'), '控件展开与选中必须使用较强持久表面')
  assert(
    fieldTrigger.includes(":hover:not(:disabled):not([aria-expanded='true'])"),
    'FieldTrigger 展开态不得被 Hover 级联覆盖',
  )
  assert(filterBar.indexOf('.ui-filter-trigger:hover') < filterBar.indexOf('.ui-filter-trigger.has-filters'), '筛选持久态规则必须位于 Hover 之后')
  assert(quickViews.indexOf('.quick-view-chip:hover') < quickViews.indexOf('.quick-view-chip.is-active'), '快捷视图选中态必须位于 Hover 之后')
  assert(sidebar.indexOf('.sb-risk-summary:hover') < sidebar.indexOf(".sb-risk-summary[aria-expanded='true']"), '风险摘要展开态必须位于 Hover 之后')
  assert(selectSource.includes("getPropertyValue('--field-height-md')"), 'Select 菜单高度估算必须读取真实字段高度令牌')
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
  assert(!/@media[^\{]*max-width:\s*(?:[1-8]\d\d|899)px/.test(css), '策略表现不得维护不受支持的手机宽度分支')
}

export async function testBusinessModalsUseTheSharedDesktopShell(): Promise<void> {
  const fs = await import('node:fs/promises')
  const modalFiles = [
    'src/components/TradeComposer.tsx',
    'src/components/TradeCloseDialog.tsx',
    'src/components/StrategyFormModal.tsx',
  ]
  const sources = await Promise.all(modalFiles.map((file) => fs.readFile(file, 'utf8')))
  for (const [index, source] of sources.entries()) {
    assert(source.includes('<ModalShell'), `${modalFiles[index]} 必须复用共享桌面弹层骨架`)
    assert(!source.includes('createPortal'), `${modalFiles[index]} 不得保留私有 portal`)
    assert(!source.includes('acquireModalOverlay'), `${modalFiles[index]} 不得重复维护弹层快捷键状态`)
    assert(!source.includes('role="dialog"'), `${modalFiles[index]} 不得重复声明 dialog 语义`)
  }
}
