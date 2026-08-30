import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testBoardUsesOneSurfaceHierarchySharedWithTheList(): Promise<void> {
  const css = await readFile('src/views/BoardView.css', 'utf8')
  const columnRule = css.match(/(?:^|\n)\.bd-col\s*\{([^}]*)\}/s)?.[1] ?? ''

  assert.match(css, /\.board-scroll\s*\{[^}]*gap:\s*0;/s)
  assert.match(css, /\.board-scroll\s*\{[^}]*background:\s*var\(--surface-pane\);/s)
  assert.match(css, /\.bd-col\s*\{[^}]*border-left:\s*1px solid var\(--border-divider\);/s)
  assert.match(css, /\.bd-col\s*\{[^}]*background:\s*transparent;/s)
  assert.doesNotMatch(columnRule, /border-radius:/)
  assert.match(css, /\.bd-card\s*\{[^}]*background:\s*var\(--surface-elevated\);/s)
  assert.match(css, /\.bd-card\s*\{[^}]*border-radius:\s*var\(--radius-6\);/s)
  assert.match(css, /\.bd-card:hover\s*\{[^}]*background:\s*var\(--surface-card-hover\);/s)
}

export async function testCaseBoardDoesNotForkASecondCardDesignLanguage(): Promise<void> {
  const css = await readFile('src/views/BoardView.css', 'utf8')
  const source = await readFile('src/views/BoardView.tsx', 'utf8')

  assert.doesNotMatch(css, /\.board-scroll-case/)
  assert.doesNotMatch(css, /\.bd-card-case/)
  assert.doesNotMatch(source, /board-scroll-case/)
  assert.doesNotMatch(source, /bd-card-case/)
}

export async function testBoardResultUsesTheSameRPresentationAsListRows(): Promise<void> {
  const source = await readFile('src/views/BoardView.tsx', 'utf8')

  assert.match(source, /resolveTradeRowResultPresentation\(/)
  assert.match(source, /className="bd-card-result"/)
  assert.match(source, /\{result\.r\.text\}/)
  assert.doesNotMatch(source, /formatTradeCashPnl\(/)
  assert.doesNotMatch(source, /fmtMoney\(/)
}
