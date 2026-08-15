import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import postcss from 'postcss'

type ProductCssSource = {
  path: string
  css: string
}

async function readAllProductCssSources(): Promise<ProductCssSource[]> {
  const files: string[] = []
  for await (const path of fs.glob('src/**/*.css')) files.push(path)
  return Promise.all(files.sort().map(async (path) => ({ path, css: await fs.readFile(path, 'utf8') })))
}

async function readAllProductCss(): Promise<string> {
  return (await readAllProductCssSources()).map(({ css }) => css).join('\n')
}

function assertCssUsesOnlyBundledSansFonts(css: string): void {
  assert(
    !/@import\s+(?:url\(\s*)?['\"]?https?:\/\/|@font-face\s*\{[^}]*\bsrc\s*:[^;}]*url\(\s*['\"]?https?:\/\//is.test(css),
    '产品 CSS 不得加载远程字体 URL',
  )
  assert(!/font-family\s*:\s*[^;{}]*(?<!-)serif\s*;/i.test(css), '产品 CSS 不得回退到 serif')
}

export function testTypographyCssContractRejectsRemoteUrlsAndSerifStacks(): void {
  assert.throws(
    () => assertCssUsesOnlyBundledSansFonts('@font-face { src: url("https://fonts.example/inter.woff2"); }'),
    /远程字体 URL/,
  )
  assert.throws(
    () => assertCssUsesOnlyBundledSansFonts('main { font-family: Georgia, serif; }'),
    /不得回退到 serif/,
  )
}

export async function testTypographySystemUsesOnlyBundledSansFontsAndCanonicalWeights(): Promise<void> {
  const [packageJson, main, tokens, global, css] = await Promise.all([
    fs.readFile('package.json', 'utf8'),
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/styles/global.css', 'utf8'),
    readAllProductCss(),
  ])

  const geistPackage = ['@fontsource', ['geist', 'sans'].join('-')].join('/')
  const geistFamily = ['Geist', 'Sans'].join(' ')
  assert(!packageJson.includes(geistPackage), '依赖图不得保留 Geist')
  assert(!main.includes(geistPackage.slice('@fontsource/'.length)), '应用入口不得导入 Geist')
  assert(!css.includes(geistFamily), '产品 CSS 不得引用 Geist')
  assertCssUsesOnlyBundledSansFonts(css)
  assert(!tokens.includes('--font-weight-bold: 700'), 'canonical 令牌不得提供 700 字重')
  assert(global.includes('font-optical-sizing: auto'), '全局 UI 字体应启用 optical sizing')
}

export async function testBothStartupPathsWaitForUiFontsWithTimeout(): Promise<void> {
  const app = await fs.readFile('src/App.tsx', 'utf8')
  assert(app.includes('async function waitForUiFonts(): Promise<void>'), '字体等待逻辑应有共享入口')
  assert.equal(
    app.split('await waitForUiFonts()').length - 1,
    2,
    '正常启动和 Welcome 完成路径都必须等待字体就绪',
  )
  assert(app.includes('document.fonts?.ready'), '字体等待必须使用 Font Loading API')
  assert(app.includes('window.setTimeout(resolve, 1200)'), '字体等待必须保留 1200ms 降级超时')
}

function cssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const normalizedCss = css.replace(/\r\n/g, '\n')
  const rules = [...normalizedCss.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'gm'))]
  const rule = rules.map((match) => match[1]).join('\n')
  assert(rule, `缺少 ${selector} 的字体角色声明`)
  return rule
}

function assertRoleDeclarations(rule: string, selector: string, declarations: Array<readonly [string, string]>): void {
  for (const [property, expected] of declarations) {
    const actual = rule.match(new RegExp(`${property}\\s*:\\s*([^;\\n]+)`))?.[1]?.trim()
    assert.equal(actual, expected, `${selector} 的 ${property} 必须为 ${expected}`)
  }
}

function usesBusinessMonoStack(css: string): boolean {
  return /font(?:-family)?\s*:\s*[^;{}]*(?:var\(\s*--font-mono\s*\)|JetBrains(?:\s+Mono)?|monospace)/i.test(css)
}

type TrackingApproval = {
  path: string
  selector: string
  renderSourcePath: string
  renderedJsx: string
  content: string
}

function isLatinUppercaseMicroLabel(content: string): boolean {
  return /^[A-Z0-9][A-Z0-9 &/._-]*$/.test(content) && /[A-Z]/.test(content)
}

function isExactSelectorRender(approval: TrackingApproval): boolean {
  const className = approval.selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1]
  if (!className) return false
  const escapedContent = approval.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<[^>]+\\bclassName=(['"])${className}\\1[^>]*>\\s*${escapedContent}\\s*</`).test(approval.renderedJsx)
}

const approvedLatinUppercaseTracking: TrackingApproval[] = []

type TrackingDeclaration = {
  path: string
  selector: string
  value: string
}

type LiteralFontSizeApproval = {
  path: string
  selector: string
  value: string
  reason: string
}

type LiteralFontSizeDeclaration = {
  path: string
  selector: string
  property: 'font-size' | 'font'
  value: string
  important: boolean
}

const approvedLiteralFontSizes: LiteralFontSizeApproval[] = [
  {
    path: 'src/editor/Editor.css',
    selector: '.editor code',
    value: '0.85em',
    reason: '内联代码需相对正文缩小，且不属于应用 UI 文字角色。',
  },
  {
    path: 'src/editor/Editor.css',
    selector: '.editor code',
    value: '.85em',
    reason: '内联代码 0.85em 的等价 CSS 数值写法，仍严格限定在相同 path 与 selector。',
  },
]

const approvedShorthandFontSizeTokens = new Set([
  '--fs-base',
  '--fs-h',
  '--fs-lg',
  '--fs-md',
  '--fs-micro',
  '--fs-mini',
  '--fs-sm',
  '--fs-title',
  '--fs-xs',
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
])

const approvedLonghandFontSizeTokens = new Set([
  ...approvedShorthandFontSizeTokens,
  '--editor-font-size',
  '--font-size-large',
  '--font-size-micro',
  '--font-size-mini',
  '--font-size-regular',
  '--font-size-small',
  '--font-size-title2',
  '--font-size-title3',
  '--modal-cta-font-size',
])

const approvedShorthandModifierKeywords = new Set([
  '400',
  '500',
  '600',
  'condensed',
  'expanded',
  'extra-condensed',
  'extra-expanded',
  'italic',
  'normal',
  'oblique',
  'semi-condensed',
  'semi-expanded',
  'small-caps',
  'ultra-condensed',
  'ultra-expanded',
])

const approvedShorthandModifierTokens = new Set([
  '--font-weight-bold',
  '--font-weight-medium',
  '--font-weight-normal',
  '--font-weight-semibold',
])

const approvedShorthandFamilyTokens = new Set([
  '--font-mono',
  '--font-ui',
  '--font-ui-base',
])

function tokenizeTopLevelFontShorthand(shorthand: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false

  const flush = (): void => {
    if (current) tokens.push(current)
    current = ''
  }

  for (const character of shorthand) {
    if (quote) {
      current += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === '(') {
      depth += 1
      current += character
      continue
    }
    if (character === ')') {
      if (depth === 0) return null
      depth -= 1
      current += character
      continue
    }
    if (depth === 0 && /\s/.test(character)) {
      flush()
      continue
    }
    if (depth === 0 && character === '/') {
      flush()
      tokens.push('/')
      continue
    }
    current += character
  }

  if (quote || depth !== 0) return null
  flush()
  return tokens
}

function customPropertyTokenName(token: string): string | null {
  return /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(token)?.[1] ?? null
}

function isApprovedLonghandFontSize(value: string): boolean {
  if (/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value)) return true
  const property = customPropertyTokenName(value)
  return property !== null && approvedLonghandFontSizeTokens.has(property)
}

function isApprovedShorthandFontSize(token: string): boolean {
  const property = customPropertyTokenName(token)
  return property !== null && approvedShorthandFontSizeTokens.has(property)
}

function isApprovedShorthandModifier(token: string): boolean {
  const property = customPropertyTokenName(token)
  return approvedShorthandModifierKeywords.has(token.toLowerCase()) || (
    property !== null && approvedShorthandModifierTokens.has(property)
  )
}

function isPlausibleShorthandFamilyStart(token: string): boolean {
  const property = customPropertyTokenName(token)
  if (property !== null) return approvedShorthandFamilyTokens.has(property)
  if (/^(["']).*\1,?$/.test(token)) return true
  return /^-?[a-z_][a-z0-9_-]*,?$/i.test(token) && !/^(?:inherit|initial|revert|revert-layer|unset)$/i.test(token)
}

function usesApprovedShorthandFontSize(shorthand: string): boolean {
  const tokens = tokenizeTopLevelFontShorthand(shorthand)
  if (!tokens || tokens.length === 0) return false

  const slashIndexes = tokens.flatMap((token, index) => token === '/' ? [index] : [])
  const sizeIndexes = tokens.flatMap((token, index) => isApprovedShorthandFontSize(token) ? [index] : [])
  if (slashIndexes.length > 1 || sizeIndexes.length !== 1) return false

  const slashIndex = slashIndexes[0]
  const sizeIndex = sizeIndexes[0]
  if (slashIndex !== undefined) {
    if (sizeIndex !== slashIndex - 1) return false
    if (!tokens.slice(0, sizeIndex).every(isApprovedShorthandModifier)) return false
    const familyStart = tokens[slashIndex + 2]
    return familyStart !== undefined && isPlausibleShorthandFamilyStart(familyStart)
  }

  if (!tokens.slice(0, sizeIndex).every(isApprovedShorthandModifier)) return false
  const familyStart = tokens[sizeIndex + 1]
  return familyStart !== undefined && isPlausibleShorthandFamilyStart(familyStart)
}

function findLiteralFontSizeDeclarations(sources: ProductCssSource[]): LiteralFontSizeDeclaration[] {
  const declarations: LiteralFontSizeDeclaration[] = []
  for (const { path, css } of sources) {
    let root: postcss.Root
    try {
      root = postcss.parse(css, { from: path })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${path}: CSS parse failed: ${message}`)
    }
    root.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase()
      if (property !== 'font-size' && property !== 'font') return

      const selector = declaration.parent?.type === 'rule' ? declaration.parent.selector.trim() : ''
      const value = declaration.value.trim()
      const important = declaration.important
      if (property === 'font-size') {
        if (!isApprovedLonghandFontSize(value)) declarations.push({ path, selector, property, value, important })
        return
      }
      if (/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value)) return
      if (!usesApprovedShorthandFontSize(value)) declarations.push({ path, selector, property, value, important })
    })
  }
  return declarations
}

function assertApprovedLiteralFontSizes(
  sources: ProductCssSource[],
  approvals: LiteralFontSizeApproval[],
): void {
  for (const declaration of findLiteralFontSizeDeclarations(sources)) {
    const approval = approvals.find((entry) =>
      declaration.property === 'font-size' && entry.path === declaration.path.replace(/\\/g, '/') && entry.selector === declaration.selector && entry.value === declaration.value,
    )
    const location = declaration.property === 'font' ? 'font shorthand' : 'font-size'
    const priority = declaration.important ? ' !important' : ''
    assert(approval?.reason, `${declaration.path} ${declaration.selector} has unapproved literal ${location}: ${declaration.value}${priority}`)
  }
}

export function testLiteralFontSizeContractRejectsRogueUiPixels(): void {
  assert.throws(
    () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css: '.bad { font-size: 22px; }' }], []),
    /unapproved literal font-size: 22px/,
  )
  assert.throws(
    () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css: '.bad { font-size: 12.5px; }' }], []),
    /unapproved literal font-size: 12.5px/,
  )
  for (const css of [
    '.bad{font-size:;}',
    '.bad{font:;}',
    '.bad{font-size:/**/;}',
    '.bad{font:/**/;}',
    '.bad{font-size:   ;}',
    '.bad{font:\t;}',
    '.bad{font-size:!important;}',
    '.bad{font:! important;}',
  ]) {
    assert.throws(
      () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], approvedLiteralFontSizes),
      /unapproved literal/,
    )
  }
  for (const css of [
    '.bad { font-size: inherit 22px; }',
    '.bad { font-size: VAR(--type-rogue-size); }',
    ':root { --TYPE-ROW-SIZE: 22px; } .bad { font-size: var(--TYPE-ROW-SIZE); }',
    '.bad { font-size: revert 12px; }',
    '.bad { font-size: inherit 22px !important; }',
    '.bad { font-size: !important 22px; }',
    '.bad { font-size: VAR(--type-row-size) !important !important; }',
    '.bad { font-size: VAR(--type-row-size) !urgent; }',
    '.bad { font-size: VAR(--type-row-size) !important garbage; }',
  ]) {
    assert.throws(
      () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], approvedLiteralFontSizes),
      /unapproved literal font-size/,
    )
  }
  for (const css of [
    '.ok { font-size: VAR(--type-row-size); }',
    '.ok { font-size: InHeRiT; }',
    '.ok { font-size: InItIaL; }',
    '.ok { font-size: UnSeT; }',
    '.ok { font-size: ReVeRt; }',
    '.ok { font-size: ReVeRt-LaYeR; }',
    '.ok { font-size: VAR(--type-row-size) !important; color: red; }',
    '.ok { font-size: InHeRiT !IMPORTANT; }',
  ]) assert.doesNotThrow(() => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], []))
  assert.doesNotThrow(() => assertApprovedLiteralFontSizes([{
    path: 'src/editor/Editor.css',
    css: '.editor code { font-size: 0.85em; }',
  }], approvedLiteralFontSizes))
  assert.doesNotThrow(() => assertApprovedLiteralFontSizes([{
    path: 'src/editor/Editor.css',
    css: '.editor code { font-size:.85em ! important; }',
  }], approvedLiteralFontSizes))
  assert.throws(
    () => assertApprovedLiteralFontSizes([{
      path: 'src/editor/Editor.css',
      css: '.editor pre { font-size: 0.85em; }',
    }], approvedLiteralFontSizes),
    /unapproved literal font-size: 0.85em/,
  )
  for (const css of [
    '.bad { font: 500 22px/28px var(--font-ui); }',
    '.bad { font: .85em var(--font-ui); }',
    '.bad { font: 500 calc(22px)/28px var(--font-ui); }',
    '.bad { font: 500 clamp(20px, 2vw, 22px)/28px var(--font-ui); }',
    '.bad { font: 500 large/28px var(--font-ui); }',
    '.bad { font: 500 0/28px var(--font-ui); }',
    '.bad { font: 500 var(--type-rogue-size) var(--font-ui); }',
    '.bad { font: 500 22px / var(--type-row-size) var(--font-ui); }',
    '.bad { font: var(--font-weight-semibold) 22px var(--type-row-size) var(--font-ui); }',
    '.bad { font: var(--type-row-size) 22px var(--font-ui); }',
    '.bad { font: var(--font-weight-semibold) var(--type-row-size) var(--type-caption-size); }',
    '.bad { font: 500 calc(22px + var(--type-row-size)) var(--font-ui); }',
    '.bad { font: fantasy-modifier var(--type-row-size) var(--font-ui); }',
    '.bad { font: 700 var(--type-row-size) var(--font-ui); }',
    '.bad { font: var(--type-row-size); }',
    '.bad { font: var(--type-row-size)/1.2; }',
    '.bad { font: inherit var(--type-row-size) var(--font-ui); }',
    ':root { --TYPE-ROW-SIZE: 22px; } .bad { font: 500 var(--TYPE-ROW-SIZE) var(--font-ui); }',
    ':root { --Type-Row-Size: 22px; } .bad { font: 500 var(--Type-Row-Size) var(--font-ui); }',
    '.bad { font: var(--FONT-WEIGHT-SEMIBOLD) var(--type-row-size) var(--font-ui); }',
    '.bad { font: var(--font-weight-semibold) var(--type-row-size) var(--FONT-UI); }',
    '.bad { font: 500 22px / var(--type-row-size) var(--font-ui) !important; }',
    '.bad { font: inherit !important !important; }',
    '.bad { font: inherit !urgent; }',
    '.bad { font: inherit !important garbage; }',
  ]) {
    assert.throws(
      () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], approvedLiteralFontSizes),
      /unapproved literal font shorthand/,
    )
  }
  assert.doesNotThrow(
    () => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css: '.ok { height: 22px; padding: 0 12.5px; }' }], []),
  )
  assert.doesNotThrow(
    () => assertApprovedLiteralFontSizes([{
      path: 'src/views/example.css',
      css: '.ok::before { content: ";font-size:;"; }',
    }], []),
  )
  for (const css of [
    '.ok::before { content: ";font:;"; }',
    '.ok { --font-example: ";font-size:;;font:;"; }',
    '.ok { background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg%3E;font-size:;%3C/svg%3E"); }',
    '.ok::before { content: ".fake { font-size: 22px; font: 500 22px serif; }"; }',
  ]) assert.doesNotThrow(() => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], []))
  assert.throws(
    () => assertApprovedLiteralFontSizes([{
      path: 'src/views/malformed.css',
      css: '.bad { font-size: 22px;',
    }], []),
    /src[\\/]views[\\/]malformed\.css: CSS parse failed/,
  )
  assert.throws(
    () => assertApprovedLiteralFontSizes([{
      path: 'src/views/example.css',
      css: '.bad { FoNt-SiZe: 22px; }',
    }], []),
    /unapproved literal font-size: 22px/,
  )
  assert.doesNotThrow(
    () => assertApprovedLiteralFontSizes([{
      path: 'src/views/example.css',
      css: '.ok { FoNt: InHeRiT !IMPORTANT; }',
    }], []),
  )
  for (const css of [
    '.ok { font: 500 var(--type-row-size)/var(--type-row-line-height) var(--font-ui); }',
    '.ok { font: var(--font-weight-semibold) var(--fs-mini) var(--font-ui); }',
    '.ok { font: italic small-caps var(--font-weight-semibold) condensed var(--type-row-size) var(--font-ui); }',
    '.ok { font: 500 var(--type-row-size) / calc(var(--type-row-line-height) / 1) var(--font-ui); }',
    '.ok { font: VAR(--font-weight-semibold) VAR(--type-row-size) VAR(--font-ui); }',
    '.ok { font: inherit; }',
    '.ok { font: InHeRiT; }',
    '.ok { font: initial; }',
    '.ok { font: unset; }',
    '.ok { font: revert; }',
    '.ok { font: revert-layer; }',
    '.ok { font: InHeRiT !important; }',
    '.ok { font: 500 var(--type-row-size)/var(--type-row-line-height) var(--font-ui) ! IMPORTANT; }',
  ]) assert.doesNotThrow(() => assertApprovedLiteralFontSizes([{ path: 'src/views/example.css', css }], []))
}

export async function testProductFontSizesUseCanonicalRolesOrNamedExceptions(): Promise<void> {
  assertApprovedLiteralFontSizes(await readAllProductCssSources(), approvedLiteralFontSizes)
}

function normalizeTrackingValue(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '').toLowerCase()
  if (compact === 'normal') return 'normal'
  if (/^-?(?:0|0?\.0+)$/.test(compact)) return '0'
  const em = /^(-?)(?:0?)(\.\d+)em$/.exec(compact)
  return em ? `${em[1]}0${em[2]}em` : null
}

function findTrackingDeclarations(sources: ProductCssSource[]): TrackingDeclaration[] {
  const declarations: TrackingDeclaration[] = []
  for (const { path, css } of sources) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim()
      const body = rule[2]
      for (const declaration of body.matchAll(/(?:^|;)\s*letter-spacing\s*:\s*([^;{}]+)(?=;|$)/gi)) {
        declarations.push({ path, selector, value: declaration[1].trim() })
      }
    }
  }
  return declarations
}

function assertApprovedTracking(
  sources: ProductCssSource[],
  approvals: TrackingApproval[],
  renderSources: Record<string, string>,
): void {
  for (const declaration of findTrackingDeclarations(sources)) {
    const normalized = normalizeTrackingValue(declaration.value)
    if (normalized === '0' || normalized === 'normal') continue
    if (normalized === '0.02em') {
      const approval = approvals.find((entry) => entry.path === declaration.path && entry.selector === declaration.selector)
      assert(approval, `${declaration.path} ${declaration.selector} 使用了未批准的 0.02em 字距`)
      assert(isLatinUppercaseMicroLabel(approval.content), `${declaration.selector} 的例外内容必须是拉丁大写微标签`)
      assert(isExactSelectorRender(approval), `${declaration.selector} 的 allowlist 必须提供该 selector 渲染精确文本的 JSX 片段`)
      assert(renderSources[approval.renderSourcePath]?.includes(approval.renderedJsx), `${declaration.selector} 的 allowlist JSX 片段必须存在于 render source`)
      continue
    }
    assert.fail(`${declaration.path} ${declaration.selector} has unapproved letter-spacing: ${declaration.value}`)
  }
}

export function testTrackingAllowlistRejectsBusinessNumbersAndRequiresExactSelectorRender(): void {
  assert.equal(isLatinUppercaseMicroLabel('USD 15M'), true)
  assert.equal(isLatinUppercaseMicroLabel('2026'), false)
  assert.equal(isLatinUppercaseMicroLabel('15/30'), false)
  assert.equal(isLatinUppercaseMicroLabel('交易'), false)
  assert.equal(isLatinUppercaseMicroLabel('USD 交易'), false)

  const approval: TrackingApproval = {
    path: 'src/components/example.css',
    selector: '.qa-latin-label',
    renderSourcePath: 'src/components/Example.tsx',
    renderedJsx: '<span className="qa-latin-label">USD 15M</span>',
    content: 'USD 15M',
  }
  assert.equal(isExactSelectorRender(approval), true)
  assert.equal(isExactSelectorRender({ ...approval, renderedJsx: '<span className="other-label">USD 15M</span>' }), false)

  const source = [{ path: approval.path, css: '.qa-latin-label { letter-spacing: .02em; }' }]
  assert.throws(
    () => assertApprovedTracking(source, [], {}),
    /未批准的 0\.02em 字距/,
  )
  assert.doesNotThrow(() => assertApprovedTracking(source, [approval], { [approval.renderSourcePath]: approval.renderedJsx }))
  for (const css of [
    '.bad { letter-spacing: .04em; }',
    '.bad{letter-spacing:.04em;}',
    '.bad { LETTER-SPACING: 0.04em; }',
    '.bad { letter-spacing: calc(0.02em); }',
    '.bad { letter-spacing: var(--tracking); }',
  ]) {
    assert.throws(() => assertApprovedTracking([{ path: 'src/components/example.css', css }], [], {}), /unapproved letter-spacing/)
  }
  assert.throws(
    () => assertApprovedTracking([{ path: 'src/components/example.css', css: '.title { letter-spacing: -.012em; }' }], [], {}),
    /unapproved letter-spacing/,
  )
  assert.doesNotThrow(() => assertApprovedTracking([
    { path: 'src/components/example.css', css: '.ok { letter-spacing: 0; } .native { letter-spacing: NORMAL; }' },
  ], [], {}))
}

export async function testPageTitleSelectorsUseTheCanonical20PxRole(): Promise<void> {
  const [app, sources] = await Promise.all([fs.readFile('src/App.tsx', 'utf8'), Promise.all([
    'src/views/DetailView.css',
    'src/views/TodayWorkspace.css',
    'src/views/ReviewSessionView.css',
    'src/views/WeeklyReviewView.css',
    'src/views/settings/SettingsLayout.css',
    'src/components/WelcomeScreen.css',
    'src/App.css',
    'src/components/RouteState.css',
  ].map(async (path) => [path, await fs.readFile(path, 'utf8')] as const)).then((entries) => Object.fromEntries(entries))])
  assert(app.includes('<h1 className="route-state-title">范围不存在</h1>'), 'invalid period 路由必须使用可审计的 Page title selector')
  for (const [path, selector] of [
    ['src/views/DetailView.css', '.dv-title'],
    ['src/views/DetailView.css', '.dv-empty-card h1'],
    ['src/views/TodayWorkspace.css', '.today-focus h1'],
    ['src/views/ReviewSessionView.css', '.review-session-intro h1,\n.review-session-finished h1'],
    ['src/views/ReviewSessionView.css', '.review-session-item-header h1'],
    ['src/views/WeeklyReviewView.css', '.wr-page-head h1'],
    ['src/views/settings/SettingsLayout.css', '.settings-page-title'],
    ['src/components/WelcomeScreen.css', '.welcome-title'],
    ['src/App.css', '.app-storage-error-card h1'],
    ['src/App.css', '.route-state-title'],
    ['src/components/RouteState.css', '.app-route-state h1'],
  ] as const) {
    assertRoleDeclarations(cssRule(sources[path], selector), selector, [
      ['font-size', 'var(--type-page-title-size)'],
      ['font-weight', 'var(--font-weight-semibold)'],
      ['line-height', 'var(--type-page-title-line-height)'],
      ['letter-spacing', '0'],
    ])
  }
}

export function testBusinessNumericContractRejectsMonoFontShorthandsAndStacks(): void {
  assert.equal(usesBusinessMonoStack('value { font-family: var(--font-mono); }'), true)
  assert.equal(usesBusinessMonoStack('value { font: 500 12px "JetBrains Mono"; }'), true)
  assert.equal(usesBusinessMonoStack('value { font-family: ui-monospace, monospace; }'), true)
  assert.equal(usesBusinessMonoStack('value { font-family: var(--font-ui); }'), false)
}

export async function testShellTypographyUsesSemanticRolesAndApprovedTracking(): Promise<void> {
  const shellPaths = [
    'src/components/Sidebar.css',
    'src/components/sidebar/SidebarWorkspace.css',
    'src/components/Topbar.css',
    'src/components/trades/TradeList.css',
    'src/components/trades/QuickViewBar.css',
    'src/components/RowPreviews.css',
    'src/views/TodayWorkspace.css',
    'src/views/BoardView.css',
    'src/views/ListView.css',
  ]
  const sources = Object.fromEntries(await Promise.all(
    shellPaths.map(async (path) => [path, await fs.readFile(path, 'utf8')] as const),
  ))

  for (const path of shellPaths) {
    const source = sources[path]
    assert(!source.includes('font-weight: 700'), `${path} 不得使用未批准的 700 字重`)
    assert(!source.includes('font-weight: 620'), `${path} 不得使用未批准的 620 字重`)
    assert(!source.includes('letter-spacing: 1px'), `${path} 不得使用扩张的 1px 字距`)
    assert(!source.includes('letter-spacing: 0.04em'), `${path} 不得使用未批准的 0.04em 字距`)
  }

  assertRoleDeclarations(cssRule(sources['src/views/TodayWorkspace.css'], '.today-focus-eyebrow'), '.today-focus-eyebrow', [
    ['font-size', 'var(--type-metadata-size)'],
    ['font-weight', 'var(--font-weight-medium)'],
    ['letter-spacing', '0'],
  ])
  assertRoleDeclarations(cssRule(sources['src/views/BoardView.css'], '.bd-card-timeframe'), '.bd-card-timeframe', [
    ['font-variant-numeric', 'var(--numeric-tabular)'],
    ['letter-spacing', '0'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/Sidebar.css'], '.sb-section-label'), '.sb-section-label', [
    ['font-size', 'var(--type-metadata-size)'],
    ['letter-spacing', '0'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/RowPreviews.css'], '.rp-note'), '.rp-note', [
    ['font-size', 'var(--type-row-size)'],
    ['line-height', 'var(--type-row-line-height)'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/trades/TradeList.css'], '.trade-row'), '.trade-row', [
    ['font-size', 'var(--type-row-size)'],
    ['font-weight', 'var(--font-weight-normal)'],
    ['line-height', 'var(--type-row-line-height)'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/trades/TradeList.css'], '.trade-list-group-header strong'), '.trade-list-group-header strong', [
    ['font-size', 'var(--type-row-size)'],
    ['font-weight', 'var(--font-weight-semibold)'],
    ['line-height', 'var(--type-row-line-height)'],
  ])

}

export async function testBusinessNumericSurfacesUseUiTabularTypography(): Promise<void> {
  const businessNumericFiles = [
    'src/components/LiveCycleSettings.css',
    'src/components/LivePerformanceCycleControl.css',
    'src/components/LivePerformanceCycleManager.css',
    'src/components/RiskStatusStrip.css',
    'src/components/TradeOpenRiskDialog.css',
    'src/components/WeeklyRiskPreparationCard.css',
    'src/components/ui/DatePicker.css',
    'src/views/Dashboard.css',
    'src/views/ReviewSessionView.css',
    'src/views/TrashView.css',
    'src/views/WeeklyReviewView.css',
  ]
  const businessNumericSources = Object.fromEntries(await Promise.all(
    businessNumericFiles.map(async (path) => [path, await fs.readFile(path, 'utf8')] as const),
  ))

  for (const [path, css] of Object.entries(businessNumericSources)) {
    assert(!usesBusinessMonoStack(css), `${path} uses mono for business data`)
    assert(!/letter-spacing\s*:\s*-(?:0)?\.(?:03|025|01)em\b/.test(css), `${path} uses unapproved title tracking`)
  }

  const numericRoleSelectors: Array<readonly [string, string]> = [
    ['src/components/LiveCycleSettings.css', '.live-cycle-preview-list > div'],
    ['src/components/LivePerformanceCycleControl.css', '.live-performance-cycle-current strong'],
    ['src/components/LivePerformanceCycleManager.css', '.live-performance-cycle-row span'],
    ['src/components/RiskStatusStrip.css', '.risk-status-values'],
    ['src/components/TradeOpenRiskDialog.css', '.trade-open-risk-periods strong'],
    ['src/components/WeeklyRiskPreparationCard.css', '.risk-preparation-risk-amount'],
    ['src/components/ui/DatePicker.css', '.ui-date-grid button'],
    ['src/views/Dashboard.css', '.db-card-value'],
    ['src/views/ReviewSessionView.css', '.review-session-result-grid strong'],
    ['src/views/TrashView.css', '.trash-item-date'],
    ['src/views/WeeklyReviewView.css', '.wr-risk-remaining b'],
  ]
  for (const [path, selector] of numericRoleSelectors) {
    assertRoleDeclarations(cssRule(businessNumericSources[path], selector), selector, [
      ['font-family', 'var(--font-ui)'],
      ['font-variant-numeric', 'var(--numeric-tabular)'],
      ['font-feature-settings', '"tnum" 1, "kern" 1'],
    ])
  }

  const [kbd, editor, routeState, routeStateView, dataIo, notionImport, riskManagement] = await Promise.all([
    fs.readFile('src/components/ui/Kbd.css', 'utf8'),
    fs.readFile('src/editor/Editor.css', 'utf8'),
    fs.readFile('src/components/RouteState.css', 'utf8'),
    fs.readFile('src/components/RouteState.tsx', 'utf8'),
    fs.readFile('src/components/DataIOContent.css', 'utf8'),
    fs.readFile('src/components/NotionImportModal.css', 'utf8'),
    fs.readFile('src/views/settings/RiskManagementSettingsPanel.css', 'utf8'),
  ])
  assert(cssRule(kbd, '.ui-kbd').includes('font-family: var(--font-mono)'), '快捷键按键必须保留 mono')
  assert(cssRule(editor, '.editor code').includes('font-family: var(--font-mono)'), '编辑器 code 必须保留 mono')
  assert(cssRule(editor, '.editor pre').includes('font-family: var(--font-mono)'), '编辑器 pre 必须保留 mono')
  assert(cssRule(routeState, '.app-route-state-code').includes('font-family: var(--font-mono)'), '路由错误码必须保留 mono')
  assertRoleDeclarations(cssRule(routeState, '.app-route-state-label'), '.app-route-state-label', [
    ['font-family', 'var(--font-ui)'],
  ])
  assert(routeStateView.includes('<span className="app-route-state-label">页面异常</span>'), '页面异常必须使用 UI 标签样式')
  assert(routeStateView.includes('<span className="app-route-state-code">404</span>'), '404 必须保留技术错误码样式')
  assert(cssRule(dataIo, '.dio-mono').includes('font-family: var(--font-mono)'), '原始数据预览必须保留 mono')
  assert(cssRule(notionImport, '.nim-file-name').includes('font-family: var(--font-mono)'), 'Notion 导入原始文件预览必须保留 mono')
  assertRoleDeclarations(cssRule(riskManagement, '.risk-data-issue-title strong'), '.risk-data-issue-title strong', [
    ['font-family', 'var(--font-ui)'],
    ['font-variant-numeric', 'var(--numeric-tabular)'],
    ['font-feature-settings', '"tnum" 1, "kern" 1'],
  ])
  assertRoleDeclarations(cssRule(riskManagement, '.risk-data-issue.is-global strong'), '.risk-data-issue.is-global strong', [
    ['font-family', 'var(--font-ui)'],
  ])
}

export async function testNarrativeAndOverlayTypographyUsesApprovedTrackingAndEditorInheritance(): Promise<void> {
  const [allProductCssSources, editor] = await Promise.all([
    readAllProductCssSources(),
    fs.readFile('src/editor/Editor.css', 'utf8'),
  ])
  const renderSources = Object.fromEntries(await Promise.all(approvedLatinUppercaseTracking.map(async (approval) => [
    approval.renderSourcePath,
    await fs.readFile(approval.renderSourcePath, 'utf8'),
  ] as const)))
  assertApprovedTracking(allProductCssSources, approvedLatinUppercaseTracking, renderSources)
  assert(editor.includes('font-family: var(--font-ui)'))
  assert(editor.includes('font-size: var(--type-body-size)'))
  assert(editor.includes('line-height: var(--type-body-line-height)'))
  assert(editor.includes('code') && editor.includes('font-family: var(--font-mono)'))

  assertRoleDeclarations(cssRule(editor, '.editor'), '.editor', [
    ['font-family', 'var(--font-ui)'],
    ['font-size', 'var(--type-body-size)'],
    ['font-weight', 'var(--font-weight-normal)'],
    ['line-height', 'var(--type-body-line-height)'],
    ['letter-spacing', '0'],
  ])
  assertRoleDeclarations(cssRule(editor, '.editor .ProseMirror'), '.editor .ProseMirror', [
    ['font-family', 'var(--font-ui)'],
    ['font-size', 'var(--type-body-size)'],
    ['font-weight', 'var(--font-weight-normal)'],
    ['line-height', 'var(--type-body-line-height)'],
    ['letter-spacing', '0'],
  ])
  assert(editor.includes('.ProseMirror :where(p, li, blockquote, h1, h2, h3, span):not(pre *, code *)'), '可见富文本必须隔离粘贴字体且不得覆盖代码后代')
  assert(editor.includes('.ProseMirror :where(code, code *, pre, pre *)'), '代码节点及其后代必须保持 mono 字体')

  const sources = Object.fromEntries(await Promise.all([
    'src/components/CsvImportModal.css',
    'src/components/NotionImportModal.css',
    'src/components/DisplayMenu.css',
    'src/components/ImageLightbox.css',
    'src/components/ContextMenu.css',
    'src/components/Menu.css',
    'src/components/CommandPalette.css',
    'src/components/Toast.css',
    'src/components/EmptyState.css',
    'src/components/RouteState.css',
  ].map(async (path) => [path, await fs.readFile(path, 'utf8')] as const)))
  assertRoleDeclarations(cssRule(editor, '.editor [data-review-context]'), '.editor [data-review-context]', [
    ['font-family', 'var(--font-ui)'],
    ['font-size', 'var(--type-body-size)'],
    ['font-weight', 'var(--font-weight-normal)'],
    ['line-height', 'var(--type-body-line-height)'],
    ['letter-spacing', '0'],
  ])
  assertRoleDeclarations(cssRule(editor, '.editor [data-review-context]::before'), '.editor [data-review-context]::before', [
    ['font-size', 'var(--type-metadata-size)'],
    ['font-weight', 'var(--type-metadata-weight)'],
    ['line-height', 'var(--type-metadata-line-height)'],
  ])
  assertRoleDeclarations(cssRule(editor, '.editor [data-review-context] strong'), '.editor [data-review-context] strong', [
    ['font-size', 'var(--type-body-size)'],
    ['font-weight', 'var(--font-weight-medium)'],
    ['line-height', 'var(--type-body-line-height)'],
  ])
  for (const [path, selector] of [
    ['src/components/DisplayMenu.css', '.display-toggle'],
    ['src/components/DisplayMenu.css', '.display-item'],
    ['src/components/ContextMenu.css', '.ctx-item'],
    ['src/components/Menu.css', '.menu-item'],
    ['src/components/CommandPalette.css', '.cmdk-item'],
  ] as const) {
    assertRoleDeclarations(cssRule(sources[path], selector), selector, [
      ['font-size', 'var(--type-row-size)'],
      ['font-weight', 'var(--type-row-weight)'],
      ['line-height', 'var(--type-row-line-height)'],
    ])
  }
  assertRoleDeclarations(cssRule(sources['src/components/Toast.css'], '.toast-panel'), '.toast-panel', [
    ['font-size', 'var(--type-metadata-size)'],
    ['line-height', 'var(--type-metadata-line-height)'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/Toast.css'], '.toast-message'), '.toast-message', [
    ['font-size', 'var(--type-row-size)'],
    ['font-weight', 'var(--font-weight-semibold)'],
    ['line-height', 'var(--type-row-line-height)'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/EmptyState.css'], '.empty-title'), '.empty-title', [
    ['font-size', 'var(--type-body-size)'],
    ['font-weight', 'var(--font-weight-semibold)'],
    ['line-height', 'var(--type-body-line-height)'],
  ])
  assertRoleDeclarations(cssRule(sources['src/components/RouteState.css'], '.app-route-state-code'), '.app-route-state-code', [
    ['font-family', 'var(--font-mono)'],
    ['letter-spacing', '0'],
  ])
}
