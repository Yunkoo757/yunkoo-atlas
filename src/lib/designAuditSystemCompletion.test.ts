function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function assertThrows(action: () => void, expected: RegExp): void {
  try {
    action()
  } catch (error) {
    assert(error instanceof Error && expected.test(error.message), `应抛出匹配 ${expected} 的错误`)
    return
  }
  throw new Error(`应抛出匹配 ${expected} 的错误`)
}

function assertDoesNotThrow(action: () => void): void {
  try {
    action()
  } catch (error) {
    throw new Error(`不应抛出错误：${error instanceof Error ? error.message : String(error)}`)
  }
}

const CSS_FILES = [
  'src/App.css',
  'src/styles/global.css',
  'src/styles/tokens.css',
  'src/components/CommandPalette.css',
  'src/components/ContextMenu.css',
  'src/components/DisplayMenu.css',
  'src/components/ImageLightbox.css',
  'src/components/Menu.css',
  'src/components/Sidebar.css',
  'src/components/StrategyFormModal.css',
  'src/components/TradeCloseDialog.css',
  'src/components/TradeComposer.css',
  'src/components/WelcomeScreen.css',
  'src/components/ui/AppFrame.css',
  'src/components/ui/DatePicker.css',
  'src/components/ui/ModalShell.css',
  'src/components/ui/Select.css',
  'src/views/BoardView.css',
  'src/views/Dashboard.css',
] as const

const APPROVED_FONT_SIZE_TOKENS = [
  '--font-size-large',
  '--font-size-micro',
  '--font-size-mini',
  '--font-size-regular',
  '--font-size-small',
  '--font-size-title2',
  '--font-size-title3',
]

const APPROVED_TYPE_SIZE_TOKENS = [
  '--type-body-size',
  '--type-caption-size',
  '--type-data-size',
  '--type-dialog-title-size',
  '--type-financial-size',
  '--type-metadata-size',
  '--type-page-title-size',
  '--type-row-size',
  '--type-section-title-size',
  '--type-ui-base-size',
]

const APPROVED_TYPE_LINE_HEIGHT_TOKENS = [
  '--type-body-line-height',
  '--type-caption-line-height',
  '--type-data-line-height',
  '--type-financial-line-height',
  '--type-metadata-line-height',
  '--type-page-title-line-height',
  '--type-row-line-height',
]

function assertApprovedTokenNames(names: string[], approved: string[], label: string): void {
  assert(names.every((name) => approved.includes(name)), `${label} 不得包含未批准名称`)
}

function assertExactTokenNames(tokens: string, tokenPattern: string, approved: string[], label: string): void {
  const names = [...tokens.matchAll(new RegExp(`^\\s*(${tokenPattern})\\s*:`, 'gm'))]
    .map((match) => match[1])
    .sort()
  assertApprovedTokenNames(names, approved, label)
  assert(names.join('\n') === [...approved].sort().join('\n'), `${label} 必须使用完整批准的名称集合`)
}

function assertCanonicalTypographyTokenNames(tokens: string): void {
  assertExactTokenNames(tokens, '--font-size-[a-z0-9-]+', APPROVED_FONT_SIZE_TOKENS, 'font-size token')
  assertExactTokenNames(tokens, '--type-[a-z0-9-]+-size(?:-lg)?', APPROVED_TYPE_SIZE_TOKENS, 'type size token')
  assertExactTokenNames(tokens, '--type-[a-z0-9-]+-line-height', APPROVED_TYPE_LINE_HEIGHT_TOKENS, 'type line-height token')
}

function assertNoDirectCoreFontSizes(css: string): void {
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert(
    !/(?:^|[;{}])\s*font-size\s*:\s*(?:11|12|13|15|20)px\s*(?:!important\s*)?(?=;|\})/im.test(declarations),
    '产品 CSS 不得直接声明核心字号，必须消费角色 var',
  )
}

export function testTypographyContractRejectsRogueNamesAndDirectCorePixels(): void {
  assertThrows(() => assertApprovedTokenNames(['--font-size-rogue'], APPROVED_FONT_SIZE_TOKENS, 'font-size token'), /未批准名称/)
  assertThrows(() => assertApprovedTokenNames(['--type-financial-size-lg'], APPROVED_TYPE_SIZE_TOKENS, 'type size token'), /未批准名称/)
  assertThrows(() => assertApprovedTokenNames(['--type-rogue-line-height'], APPROVED_TYPE_LINE_HEIGHT_TOKENS, 'type line-height token'), /未批准名称/)
  for (const size of [11, 12, 13, 15, 20]) {
    assertThrows(() => assertNoDirectCoreFontSizes(`.bad { font-size: ${size}px; }`), /直接声明核心字号/)
  }
  assertDoesNotThrow(() => assertNoDirectCoreFontSizes('.ok { height: 13px; padding: 0 11px; }'))
}

export async function testResponsiveBreakpointsUseTheSharedViewportSet(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const allowed = new Set([480, 640, 768, 899, 1024, 1099, 1200, 1268, 1439])
  const roots = ['src/components', 'src/views']
  const files: string[] = []
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target)
      else if (entry.name.endsWith('.css')) files.push(target)
    }
  }
  for (const root of roots) await collect(root)
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    for (const media of css.matchAll(/@media[^\{]*\{/g)) {
      for (const match of media[0].matchAll(/max-width:\s*(\d+)px/g)) {
        assert(allowed.has(Number(match[1])), `${file} 使用了未治理断点 ${match[1]}px`)
      }
    }
  }
}

export async function testGlobalLayersUseNamedZIndexTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const files = [
    'src/App.css',
    'src/components/ContextMenu.css',
    'src/components/DisplayMenu.css',
    'src/components/ImageLightbox.css',
    'src/components/Menu.css',
    'src/components/StrategyFormModal.css',
    'src/components/TradeCloseDialog.css',
    'src/components/TradeComposer.css',
    'src/components/WelcomeScreen.css',
    'src/components/ui/DatePicker.css',
    'src/components/ui/ModalShell.css',
    'src/components/ui/Select.css',
  ]
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    assert(!/z-index:\s*\d+/.test(css), `${file} 的全局层级仍使用数字魔数`)
  }
}

export async function testTypographyAndTokenNamesHaveOneCanonicalBaseline(): Promise<void> {
  const fs = await import('node:fs/promises')
  const sources = await Promise.all(CSS_FILES.map((file) => fs.readFile(file, 'utf8')))
  const all = sources.join('\n')
  const tokens = sources[2]
  const productCssFiles: string[] = []
  for await (const path of fs.glob('src/**/*.css')) productCssFiles.push(path)
  const productCss = (await Promise.all(
    productCssFiles
      .filter((path) => path.replace(/\\/g, '/') !== 'src/styles/tokens.css')
      .sort()
      .map((path) => fs.readFile(path, 'utf8')),
  )).join('\n')

  for (const [role, fontSize, expectedSize, lineHeight, expectedLineHeight] of [
    ['--type-caption-size', '--font-size-micro', '11px', '--type-caption-line-height', '16px'],
    ['--type-metadata-size', '--font-size-mini', '12px', '--type-metadata-line-height', '16px'],
    ['--type-row-size', '--font-size-small', '13px', '--type-row-line-height', '20px'],
    ['--type-body-size', '--font-size-regular', '15px', '--type-body-line-height', '23px'],
    ['--type-page-title-size', '--font-size-title3', '20px', '--type-page-title-line-height', '28px'],
  ] as const) {
    assert(tokens.includes(`${fontSize}: ${expectedSize}`), `${fontSize} 必须定义为 ${expectedSize}`)
    assert(tokens.includes(`${role}: var(${fontSize})`), `${role} 必须复用 ${fontSize}`)
    assert(tokens.includes(`${lineHeight}: ${expectedLineHeight}`), `${lineHeight} 必须定义为 ${expectedLineHeight}`)
  }
  assert(tokens.includes('--type-ui-base-size: var(--font-size-small)'), 'UI 基线必须明确复用 13px small token')
  assertCanonicalTypographyTokenNames(tokens)
  for (const obsolete of ['largePlus', 'regularPlus', 'smallPlus', 'miniPlus', 'quickTransition', '--font-monospace', '--bg-border-color']) {
    assert(!all.includes(obsolete), `仍存在重复或非 kebab-case token：${obsolete}`)
  }
  assertNoDirectCoreFontSizes(productCss)
  assert(!/border-radius:\s*(999|9999)px/.test(all), '胶囊圆角必须统一使用 radius-full')
}

export async function testFieldPrimitivesOwnTheSharedSizeAndFocusContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [globalCss, selectCss, dateCss] = await Promise.all([
    fs.readFile('src/styles/global.css', 'utf8'),
    fs.readFile('src/components/ui/Select.css', 'utf8'),
    fs.readFile('src/components/ui/DatePicker.css', 'utf8'),
  ])
  assert(globalCss.includes('height: var(--field-height-md)'), '输入基线必须统一定义高度')
  assert(globalCss.includes('padding-inline: var(--field-padding-inline)'), '输入基线必须统一定义水平内边距')
  assert(!/height:\s*30px/.test(selectCss + dateCss), 'Select 与 DatePicker 不得偏离字段高度 token')
}

export async function testMotionUsesTransformsAndOwnsItsKeyframes(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [globalCss, boardCss, updatesCss, updatesSource, contextCss] = await Promise.all([
    fs.readFile('src/styles/global.css', 'utf8'),
    fs.readFile('src/views/BoardView.css', 'utf8'),
    fs.readFile('src/views/settings/UpdatesSettingsPanel.css', 'utf8'),
    fs.readFile('src/views/settings/UpdatesSettingsPanel.tsx', 'utf8'),
    fs.readFile('src/components/ContextMenu.css', 'utf8'),
  ])
  assert(!globalCss.includes('@keyframes rowIn') && !globalCss.includes('@keyframes panelIn'), '未使用的全局 keyframes 必须删除')
  assert(!boardCss.includes('animation: cardIn') && !boardCss.includes('dropPulse'), '看板不得在重排或拖拽时重播装饰动画')
  assert(!updatesCss.includes('transition: width'), '更新进度条不得动画布局属性 width')
  assert(updatesSource.includes('transform: `scaleX('), '更新进度条必须用 transform 表达进度')
  assert(contextCss.includes('@keyframes context-menu-in'), 'ContextMenu 必须自带 keyframes，不能依赖 Menu.css')
}

export async function testNestedRadiiFollowTheOuterRadiusMinusGapRule(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [menuCss, displayCss, riskCss] = await Promise.all([
    fs.readFile('src/components/Menu.css', 'utf8'),
    fs.readFile('src/components/DisplayMenu.css', 'utf8'),
    fs.readFile('src/components/RiskStatusStrip.css', 'utf8'),
  ])
  assert(/\.menu-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-5\)/.test(menuCss), '5px 内间隙的菜单项应使用 5px 内圆角')
  assert(/\.display-toggle\s*\{[\s\S]*?border-radius:\s*var\(--radius-4\)/.test(displayCss), '6px 内间隙的显示菜单项应使用 4px 内圆角')
  assert(!/\.risk-status-period\s*\{[^}]*border-radius:/.test(riskCss), '大内间隙下的嵌套风险状态区段不应继续使用圆角')
}

export async function testCustomModalsConsumeTheSharedSurfaceMetrics(): Promise<void> {
  const fs = await import('node:fs/promises')
  const shellCss = await fs.readFile('src/components/ui/ModalShell.css', 'utf8')
  for (const token of [
    'var(--modal-overlay-padding)',
    'var(--modal-header-padding)',
    'var(--modal-border-radius)',
  ]) {
    assert(shellCss.includes(token), `共享弹层骨架缺少 ${token}`)
  }
  const files = [
    'src/components/TradeComposer.tsx',
    'src/components/TradeCloseDialog.tsx',
    'src/components/StrategyFormModal.tsx',
  ]
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    assert(source.includes('<ModalShell'), `${file} 未复用共享弹层骨架`)
  }
}

export async function testModalPrimaryActionsShareOneSizeContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [tokens, button, composer, close, welcome] = await Promise.all([
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/components/ui/Button.css', 'utf8'),
    fs.readFile('src/components/TradeComposer.css', 'utf8'),
    fs.readFile('src/components/TradeCloseDialog.css', 'utf8'),
    fs.readFile('src/components/WelcomeScreen.css', 'utf8'),
  ])
  for (const token of ['--modal-cta-height', '--modal-cta-padding-inline', '--modal-cta-radius', '--modal-cta-font-size']) {
    assert(tokens.includes(`${token}:`), `缺少统一弹窗 CTA 指标 ${token}`)
  }
  for (const [name, css] of [['Button', button], ['TradeComposer', composer], ['TradeCloseDialog', close], ['WelcomeScreen', welcome]]) {
    assert(css.includes('var(--modal-cta-padding-inline)') && css.includes('var(--modal-cta-radius)') && css.includes('var(--modal-cta-font-size)'), `${name} 的弹窗 CTA 仍保留独立尺寸`)
  }
}

export async function testDesktopControlMetricsNeverSwitchToTouchTargets(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/styles/tokens.css', 'utf8')
  assert(!css.includes('(pointer: coarse)'), '桌面令牌不得按粗指针切换控件尺寸')
  assert(!css.includes('--touch-target'), '桌面令牌不得保留 44px 触摸热区角色')
  assert(css.includes('--control-height-sm: 28px'), '紧凑控件高度必须为 28px')
  assert(css.includes('--control-height-md: 32px'), '标准控件高度必须为 32px')
  assert(css.includes('--control-height-lg: 36px'), '强调控件高度必须为 36px')
}

export async function testSharedUiComponentsOnlyConsumeSemanticColors(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const files: string[] = []
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target)
      else if (entry.name.endsWith('.css')) files.push(target)
    }
  }
  await collect('src/components/ui')
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    assert(
      !/(?:#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blch\()/i.test(css),
      `${file} 绕过语义色 token 使用了原始颜色`,
    )
  }
}

export async function testEveryConsumedCustomPropertyHasASourceDefinition(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const files: string[] = []
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target)
      else if (/\.(?:css|ts|tsx)$/.test(entry.name)) files.push(target)
    }
  }
  await collect('src')
  const sourceFiles = files.filter((file) => !file.includes('.test.'))
  const sources = await Promise.all(sourceFiles.map((file) => fs.readFile(file, 'utf8')))
  const source = sources.join('\n')
  const cssSource = sourceFiles
    .map((file, index) => file.endsWith('.css') ? sources[index] : '')
    .join('\n')
  const definitions = new Set([...source.matchAll(/(--[a-z0-9_-]+)["']?\s*:/gi)].map((match) => match[1]))
  const consumed = new Set([...cssSource.matchAll(/var\((--[a-z0-9_-]+)/gi)].map((match) => match[1]))
  const undefinedProperties = [...consumed].filter((property) => !definitions.has(property)).sort()
  assert(undefinedProperties.length === 0, `存在未定义自定义属性：${undefinedProperties.join(', ')}`)
}

export async function testSpacingScaleIsUsedForCanonicalSpacingValues(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const files: string[] = []
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target)
      else if (entry.name.endsWith('.css') && entry.name !== 'tokens.css') files.push(target)
    }
  }
  await collect('src')
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    for (const declaration of css.matchAll(/(?:margin|padding|gap|inset)(?:-[a-z]+)?\s*:\s*[^;]+/g)) {
      if (file.endsWith('TradeList.css') && declaration[0] === 'inset: 2px 8px') continue
      if (file.endsWith('FilterBar.css') && declaration[0] === 'padding: 0 15px 0 8px') continue
      assert(!/(^|[\s(])(?:4|8|12|16|20|24|28|32)px\b/.test(declaration[0]), `${file} 的标准间距仍绕过 spacing token：${declaration[0]}`)
    }
  }
}

export async function testMissedOpportunityInsetsUseSharedDesktopSpacingTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = (await fs.readFile('src/views/MissedOpportunitiesView.css', 'utf8'))
    .replace(/\r\n?/g, '\n')

  assert(
    /\.missed-merge-note\s*\{[^}]*margin:\s*var\(--sp-2\)\s+var\(--sp-4\);/s.test(css),
    '错过机会桌面合并说明必须使用 16px 的 --sp-4 横向间距',
  )
  assert(
    /\.missed-filter-panel\s*\{[^}]*left:\s*var\(--sp-4\);/s.test(css),
    '错过机会桌面筛选面板必须使用 16px 的 --sp-4 左侧 inset',
  )
}

export async function testCssModifiersUseTheSingleIsStateConvention(): Promise<void> {
  const fs = await import('node:fs/promises')
  const sources = await Promise.all(CSS_FILES.map((file) => fs.readFile(file, 'utf8')))
  assert(!/\.[a-z0-9-]+--[a-z0-9-]+/.test(sources.join('\n')), 'CSS 修饰符必须统一使用独立的 .is-* 状态类')
}
