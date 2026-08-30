import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testDetailUsesDesktopReviewHierarchy(): Promise<void> {
  const [layout, css, source] = await Promise.all([
    readFile('src/components/trades/TradeDetailLayout.css', 'utf8'),
    readFile('src/views/DetailView.css', 'utf8'),
    readFile('src/views/DetailView.tsx', 'utf8'),
  ])

  assert(layout.includes('minmax(620px, 1fr) 336px'), '交易详情必须优先保证 620px 复盘正文与 336px 属性栏')
  assert.match(layout, /\.trade-detail-layout \.dv-props\s*\{[^}]*border-left:\s*1px solid var\(--border-divider\)/s)
  assert.match(layout, /\.trade-detail-layout \.dv-props\s*\{[^}]*background:\s*var\(--surface-pane\)/s)
  assert.match(css, /\.dv-note-load\.is-loading\s*\{[^}]*background:\s*var\(--surface-floating\)/s)
  assert(!/\.dv-editor[^}]*min-height:\s*240px/s.test(css), '短复盘正文不得被 240px 空白撑高')
  assert.match(css, /\.dv-editor[^}]*min-height:\s*96px/s)
  assert(source.includes("trade.tradeKind === 'case' ? '案例沉淀正文' : '复盘正文'"), '普通交易主编辑器必须命名为复盘正文，同时保留案例沉淀语义')
  assert(source.includes('aria-label="补充追记"'), '追记编辑器必须命名为补充追记')
}
