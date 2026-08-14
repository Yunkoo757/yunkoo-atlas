import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

async function readAllProductCss(): Promise<string> {
  const files: string[] = []
  for await (const path of fs.glob('src/**/*.css')) files.push(path)
  return (await Promise.all(files.sort().map((path) => fs.readFile(path, 'utf8')))).join('\n')
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
  assert(!/@import\s+(?:url\()?\s*['\"]?https?:\/\/[^\s)'\"]+/i.test(css), '产品 CSS 不得加载远程字体 URL')
  assert(!/font-family\s*:\s*serif\s*;/i.test(css), '产品 CSS 不得回退到 serif')
  assert(!tokens.includes('--font-weight-bold: 700'), 'canonical 令牌不得提供 700 字重')
  assert(global.includes('font-optical-sizing: auto'), '全局 UI 字体应启用 optical sizing')
}
