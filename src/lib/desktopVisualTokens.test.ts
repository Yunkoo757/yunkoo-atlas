import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testDesktopVisualTokensExposeCanonicalRoles(): Promise<void> {
  const css = await fs.readFile('src/styles/tokens.css', 'utf8')
  for (const token of [
    '--type-body-size: 0.9375rem',
    '--type-data-size: 0.8125rem',
    '--type-metadata-size: 0.75rem',
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

export async function testUiFontUsesBundledGeistAndCjkFallbacks(): Promise<void> {
  const [main, tokens] = await Promise.all([
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
  ])
  assert(main.includes("@fontsource/geist-sans/400.css"))
  assert(main.includes("@fontsource/geist-sans/500.css"))
  assert(main.includes("@fontsource/geist-sans/600.css"))
  assert(!main.includes('@fontsource-variable/inter'))
  assert(tokens.includes('"Geist Sans"'))
  assert(tokens.includes('"PingFang SC"') && tokens.includes('"Microsoft YaHei"'))
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
