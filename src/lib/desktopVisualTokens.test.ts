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
    '--color-text-primary: lch(96% 0.6 272 / 1)',
    '--color-text-secondary: lch(82% 1.1 272 / 1)',
    '--color-text-tertiary: lch(61.399% 1.15 272 / 1)',
    '--color-text-quaternary: lch(55% 1.15 272 / 1)',
    '--color-text-disabled: lch(36.308% 1.15 272 / 1)',
    '--type-caption-size: var(--font-size-micro)',
    '--type-caption-line-height: 16px',
    '--type-metadata-size: var(--font-size-mini)',
    '--type-metadata-line-height: 16px',
    '--type-row-size: var(--font-size-small)',
    '--type-row-line-height: 20px',
    '--type-body-size: var(--font-size-regular)',
    '--type-body-line-height: 23px',
    '--type-page-title-size: var(--font-size-title3)',
    '--type-page-title-line-height: 28px',
    '--numeric-tabular: tabular-nums',
    '--icon-sm: 14px',
    '--icon-md: 16px',
    '--icon-lg: 18px',
    '--icon-xl: 20px',
    '--icon-2xl: 24px',
    '--control-height-sm: 28px',
    '--control-height-md: 32px',
    '--control-height-lg: 36px',
    '--motion-state: 100ms',
    '--motion-dialog-in: 150ms',
    '--motion-panel: 220ms',
    '--surface-app:',
    '--surface-pane:',
    '--surface-inset:',
    '--surface-floating:',
    '--skeleton-highlight:',
  ]) assert(css.includes(token), `missing ${token}`)
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
