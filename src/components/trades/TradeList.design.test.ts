function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListGroupToggleMatchesLinearCollapseContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/trades/TradeList.tsx', 'utf8')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')
  const statusIcon = await fs.readFile('src/components/StatusIcon.tsx', 'utf8')
  const chevron = await fs.readFile('src/icons/linear/chrome/LinearChromeIcons.tsx', 'utf8')

  assert(source.includes('aria-expanded={item.openProgress > 0.5}'), '分组头必须暴露 aria-expanded')
  assert(source.includes('animateGroupTo'), '分组开合必须走动画进度，而非瞬间删行')
  assert(source.includes('EASE_OUT_QUART'), '折叠缓动应对齐 Linear ease-out-quart')
  assert(source.includes('COLLAPSE_MS'), '折叠时长应对齐 Linear 布局动效')
  assert(source.includes('ROW_HEIGHT * item.openProgress'), '行高必须随 openProgress 平滑收展')
  assert(source.includes('LinearChevronIcon'), '分组折叠必须使用 LinearChevronIcon')
  assert(source.includes('LinearIssueStatusIcon'), '复盘分组头应使用 Linear Issue Status 图标')
  assert(chevron.includes('M1.915.557'), 'caret 应使用 Linear 圆角实心 ChevronIcon 路径')
  assert(chevron.includes('translate(3.05 5.35)'), 'caret 应居中到 16×16 光学网格')
  assert(css.includes('will-change: transform'), '三角旋转应开启合成层以保证流畅')
  assert(tokens.includes('--status-completed: var(--accent);'), '完成态色应对齐 Linear Done 靛蓝')
  assert(tokens.includes('--status-canceled:'), '取消/亏损态色应对齐 Linear Canceled 中性灰')
  assert(statusIcon.includes("win: 'var(--status-completed)'"), '盈利状态图标应使用 Completed 色而非盈亏绿')
  assert(statusIcon.includes("loss: 'var(--status-canceled)'"), '亏损状态图标应使用 Canceled 色而非盈亏红')
}
