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
    '--list-text-strong: var(--text-primary)',
    '--list-text-primary: var(--text-primary)',
    '--list-text-secondary: var(--text-tertiary)',
    '--list-group-title: var(--text-primary)',
    '--type-caption-size: var(--font-size-micro)',
    '--type-caption-line-height: 16px',
    '--type-metadata-size: var(--font-size-mini)',
    '--type-metadata-line-height: 18px',
    '--type-metadata-weight: var(--font-weight-normal)',
    '--type-row-size: var(--font-size-small)',
    '--type-row-line-height: 20px',
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
    '--surface-app:',
    '--surface-pane:',
    '--surface-inset:',
    '--surface-floating:',
    '--skeleton-highlight:',
  ]) assert(css.includes(token), `missing ${token}`)
  assert(!/--list-(?:text-(?:strong|primary|secondary)|group-title):\s*lch\(/.test(css), '列表文字不得保留独立 LCH 灰阶')
  assert(!css.includes('--header-h: 43.5714px'), 'header height must use the 44px canonical role')
}

export async function testUiFontUsesBundledInterAndPlatformCjkFallbacks(): Promise<void> {
  const [main, tokens, global] = await Promise.all([
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/styles/global.css', 'utf8'),
  ])
  assert(main.includes("@fontsource-variable/inter"))
  assert(!main.includes(['@fontsource', ['geist', 'sans'].join('-')].join('/')))
  assert(tokens.includes('"Inter Variable"'))
  assert(tokens.includes('system-ui'))
  assert(tokens.includes('"PingFang SC"'))
  assert(tokens.includes('"Microsoft YaHei UI"'))
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
  const source = await fs.readFile('src/icons/iconSize.ts', 'utf8')
  for (const contract of [
    'ICON_SM = 14',
    'ICON_MD = 16',
    'ICON_LG = 18',
    'ICON_XL = 20',
    'ICON_2XL = 24',
  ]) assert(source.includes(contract), `missing ${contract}`)
  assert(!source.includes('ICON_XS = 12'), 'desktop control icons must not expose a 12px tier')
}
