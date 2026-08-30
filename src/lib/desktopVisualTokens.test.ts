import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testDesktopVisualTokensExposeCanonicalRoles(): Promise<void> {
  const css = await fs.readFile('src/styles/tokens.css', 'utf8')
  for (const token of [
    '--font-size-micro: 11px',
    '--font-size-mini: 12px',
    '--font-size-small: 13px',
    '--font-size-regular: 15px',
    '--font-size-title3: 20px',
    '--text-content-strong: lch(98% 0.4 272 / 1)',
    '--text-content-supporting: lch(88% 0.8 272 / 1)',
    '--text-content-metadata: lch(62% 1.2 272 / 1)',
    '--text-content-context: lch(56% 1.2 272 / 1)',
    '--text-content-faint: lch(38% 1.2 272 / 1)',
    '--text-primary: var(--text-content-strong)',
    '--text-secondary: lch(70% 1 272 / 1)',
    '--text-tertiary: var(--text-content-context)',
    '--text-quaternary: var(--text-content-faint)',
    '--text-disabled: lch(34% 1 272 / 1)',
    '--color-text-primary: var(--text-primary)',
    '--color-text-secondary: var(--text-secondary)',
    '--color-text-tertiary: var(--text-tertiary)',
    '--color-text-quaternary: var(--text-quaternary)',
    '--color-text-disabled: var(--text-disabled)',
    '--text-nav-rest: var(--text-content-metadata)',
    '--text-nav-hover: var(--text-content-supporting)',
    '--text-nav-active: var(--text-content-strong)',
    '--text-list-strong: var(--text-content-strong)',
    '--text-list-secondary: lch(74% 1.2 272 / 1)',
    '--text-list-header: lch(68% 1.2 272 / 1)',
    '--text-chip: lch(68% 1.2 272 / 1)',
    '--list-text-strong: var(--text-list-strong)',
    '--list-text-primary: var(--text-nav-hover)',
    '--list-text-secondary: var(--text-list-secondary)',
    '--list-text-context: var(--text-content-context)',
    '--list-group-title: var(--text-primary)',
    '--list-status-opacity-rest: 0.72',
    '--list-status-opacity-active: 0.92',
    '--list-interactive-border-rest:',
    '--list-interactive-border-hover:',
    '--type-caption-size: var(--font-size-micro)',
    '--type-caption-line-height: 16px',
    '--type-metadata-size: var(--font-size-mini)',
    '--type-metadata-line-height: 18px',
    '--type-metadata-weight: var(--font-weight-normal)',
    '--type-row-size: var(--font-size-small)',
    '--type-row-line-height: 20px',
    '--type-nav-size: 14px',
    '--type-nav-line-height: 20px',
    '--type-nav-weight: 450',
    '--type-nav-active-weight: 500',
    '--type-list-primary-size: 13px',
    '--type-list-primary-line-height: 20px',
    '--type-list-primary-weight: 500',
    '--type-list-secondary-size: 13px',
    '--type-list-secondary-line-height: 20px',
    '--type-list-secondary-weight: 450',
    '--type-chip-size: 12px',
    '--type-chip-line-height: 18px',
    '--type-chip-weight: 450',
    '--type-body-size: var(--font-size-regular)',
    '--type-body-line-height: 23px',
    '--type-page-title-size: var(--font-size-title3)',
    '--type-page-title-line-height: 28px',
    '--type-toolbar-title-size: 14px',
    '--type-toolbar-title-line-height: 20px',
    '--numeric-tabular: lining-nums tabular-nums',
    '--icon-sm: 14px',
    '--icon-md: 16px',
    '--icon-lg: 18px',
    '--icon-xl: 20px',
    '--icon-2xl: 24px',
    '--icon-stroke-width: 1.75',
    '--icon-color-rest: var(--text-content-metadata)',
    '--icon-color-hover: var(--text-content-supporting)',
    '--icon-color-active: var(--text-content-strong)',
    '--control-height-sm: 28px',
    '--control-height-md: 32px',
    '--control-height-lg: 36px',
    '--page-rail-wide: 1240px',
    '--page-rail-standard: 1180px',
    '--page-rail-reading: 920px',
    '--page-rail-form: 680px',
    '--page-inset-compact: var(--sp-5)',
    '--page-inset-default: var(--sp-7)',
    '--page-inset-wide: var(--sp-8)',
    '--motion-state: 100ms',
    '--motion-dialog-in: 150ms',
    '--motion-panel: 220ms',
    '--bg-color: lch(2.6% 0.4 272 / 1)',
    '--color-bg-primary: lch(5.52% 0.4 272 / 1)',
    '--color-bg-secondary: lch(7.32% 0.85 272 / 1)',
    '--color-bg-tertiary: lch(8.22% 1.3 272 / 1)',
    '--color-bg-quaternary: lch(9.35% 0.85 272 / 1)',
    '--color-border-primary: lch(9.84% 1.48 272 / 1)',
    '--color-border-secondary: lch(14.16% 1.48 272 / 1)',
    '--color-border-tertiary: lch(16.32% 1.48 272 / 1)',
    '--bg-hover: lch(10.15% 0.6 272 / 1)',
    '--surface-group: lch(10.8% 0.85 272 / 1)',
    '--surface-nav-hover: var(--bg-hover)',
    '--surface-nav-active: lch(13.85% 1.3 272 / 1)',
    '--surface-control: var(--color-bg-secondary)',
    '--surface-control-hover: var(--bg-hover)',
    '--surface-control-active: lch(16.7% 1 272 / 1)',
    '--border-divider: lch(12.4% 0.9 272 / 1)',
    '--border-list-header: lch(14% 0.9 272 / 1)',
    '--tag-neutral-border: transparent',
    '--tag-session-border: transparent',
    '--symbol-list-glyph-strength: 64%',
    '--symbol-list-surface-strength: 6%',
    '--trade-row-height: 44px',
    '--surface-row-hover: lch(10.7% 0.6 272 / 1)',
    '--surface-card-hover: var(--bg-hover)',
    '--surface-menu-hover: lch(13.1% 0.85 272 / 1)',
    '--surface-menu-pressed: lch(15.1% 1 272 / 1)',
    '--surface-menu-selected: color-mix(in srgb, var(--accent) 11%, var(--surface-menu-hover))',
    '--border-chrome: var(--color-border-primary)',
    '--surface-app:',
    '--surface-pane:',
    '--surface-inset:',
    '--surface-floating:',
    '--surface-nav-hover:',
    '--surface-nav-active:',
    '--skeleton-highlight:',
  ]) assert(css.includes(token), `missing ${token}`)
  assert(!/--list-(?:text-(?:strong|primary|secondary)|group-title):\s*lch\(/.test(css), '列表文字不得保留独立 LCH 灰阶')
  assert(!css.includes('--header-h: 43.5714px'), 'header height must use the 44px canonical role')
}

export async function testUiFontUsesInterAndDesktopSystemCjkFallback(): Promise<void> {
  const [main, typographyBrowserTest, tokens, global] = await Promise.all([
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/views/TypographyRoles.browser.test.ts', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/styles/global.css', 'utf8'),
  ])
  assert(main.includes("@fontsource-variable/inter"))
  assert(!main.includes("@fontsource-variable/noto-sans-sc"), '桌面中文应由系统字体回退，不再强制内置 Noto Sans SC')
  assert(!typographyBrowserTest.includes("@fontsource-variable/noto-sans-sc"), '字体回归不得继续加载已移除的 Noto 包')
  assert(!main.includes(['@fontsource', ['geist', 'sans'].join('-')].join('/')))
  const uiFontDeclaration = tokens.match(/--font-ui-base:[\s\S]*?;/)?.[0] ?? ''
  const inter = uiFontDeclaration.indexOf('"Inter Variable"')
  const sfPro = uiFontDeclaration.indexOf('"SF Pro Display"')
  const appleSystem = uiFontDeclaration.indexOf('-apple-system')
  const segoe = uiFontDeclaration.indexOf('"Segoe UI"')
  assert(
    inter >= 0 && sfPro > inter && appleSystem > sfPro && segoe > appleSystem,
    'UI 字体必须采用经 A/B 确认的 Linear 桌面系统栈',
  )
  assert(!uiFontDeclaration.includes('"Noto Sans SC Variable"'))
  assert(!uiFontDeclaration.includes('"Microsoft YaHei UI"'))
  for (const contract of [
    '--font-size-micro: 11px',
    '--font-size-mini: 12px',
    '--font-size-small: 13px',
    '--font-size-regular: 15px',
    '--font-size-title3: 20px',
    '--font-weight-normal: 400',
    '--font-weight-medium: 500',
    '--font-weight-semibold: 600',
  ]) assert(tokens.includes(contract), `missing ${contract}`)
  assert(global.includes('font-optical-sizing: auto'))
}

export async function testDesktopIconConstantsMatchTheNamedScale(): Promise<void> {
  const [source, buttonCss, iconButtonCss, sidebarCss, settingsCss] = await Promise.all([
    fs.readFile('src/icons/iconSize.ts', 'utf8'),
    fs.readFile('src/components/ui/Button.css', 'utf8'),
    fs.readFile('src/components/ui/IconButton.css', 'utf8'),
    fs.readFile('src/components/Sidebar.css', 'utf8'),
    fs.readFile('src/views/settings/SettingsLayout.css', 'utf8'),
  ])
  for (const contract of [
    'ICON_SM = 14',
    'ICON_MD = 16',
    'ICON_LG = 18',
    'ICON_XL = 20',
    'ICON_2XL = 24',
  ]) assert(source.includes(contract), `missing ${contract}`)
  assert(!source.includes('ICON_XS = 12'), 'desktop control icons must not expose a 12px tier')
  for (const [label, css] of [
    ['button', buttonCss],
    ['icon button', iconButtonCss],
    ['sidebar', sidebarCss],
    ['settings navigation', settingsCss],
  ] as const) {
    assert(css.includes('stroke-width: var(--icon-stroke-width)'), `${label} icons must use the shared optical stroke`)
    assert(css.includes('shape-rendering: geometricPrecision'), `${label} icons must preserve geometric precision`)
  }
}
