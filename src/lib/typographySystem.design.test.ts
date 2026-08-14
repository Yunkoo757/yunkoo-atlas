import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

async function readAllProductCss(): Promise<string> {
  const files: string[] = []
  for await (const path of fs.glob('src/**/*.css')) files.push(path)
  return (await Promise.all(files.sort().map((path) => fs.readFile(path, 'utf8')))).join('\n')
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
  const rule = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1]
  assert(rule, `缺少 ${selector} 的字体角色声明`)
  return rule
}

function assertRoleDeclarations(rule: string, selector: string, declarations: Array<readonly [string, string]>): void {
  for (const [property, expected] of declarations) {
    const actual = rule.match(new RegExp(`${property}\\s*:\\s*([^;\\n]+)`))?.[1]?.trim()
    assert.equal(actual, expected, `${selector} 的 ${property} 必须为 ${expected}`)
  }
}

export async function testShellTypographyUsesSemanticRolesAndApprovedTracking(): Promise<void> {
  const sources = Object.fromEntries(await Promise.all([
    'src/components/Sidebar.css',
    'src/components/sidebar/SidebarWorkspace.css',
    'src/components/trades/TradeList.css',
    'src/components/RowPreviews.css',
    'src/views/TodayWorkspace.css',
    'src/views/BoardView.css',
  ].map(async (path) => [path, await fs.readFile(path, 'utf8')] as const)))

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

  const allShellCss = Object.values(sources).join('\n')
  const trackedRules = [...allShellCss.matchAll(/[^{}]+\{[^{}]*letter-spacing:\s*0\.02em[^{}]*\}/g)]
  assert(trackedRules.length > 0, '全大写微标签必须保留受控的 0.02em 字距')
  for (const match of trackedRules) {
    assert(match[0].includes('font-size: var(--type-caption-size)'), '0.02em 字距只能用于 Caption 微标签')
    assert(match[0].includes('text-transform: uppercase'), '0.02em 字距只能用于全大写微标签')
  }
}
