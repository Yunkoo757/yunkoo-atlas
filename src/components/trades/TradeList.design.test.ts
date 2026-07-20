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
  assert(chevron.includes('M7.00194 10.6239'), 'caret 应使用 Linear CollapseArrowIcon 原路径')
  assert(source.includes('rotate(${90 * item.openProgress}deg)'), '展开时 CollapseArrow 应从朝右旋至朝下')
  assert(css.includes('will-change: transform'), '三角旋转应开启合成层以保证流畅')
  assert(css.includes('--trade-group-chevron'), '分组三角应按状态/远近 tint，而非整条换底色')
  assert(tokens.includes('--group-chevron-started:'), 'Started 三角色应对齐 Linear 实测 hue')
  assert(tokens.includes('--status-completed: var(--pos);'), '盈利完成态色应对齐盈亏绿')
  assert(tokens.includes('--status-canceled:'), '取消/亏损态色应对齐 Linear Canceled 中性灰')
  assert(statusIcon.includes("win: 'var(--pos)'"), '盈利状态图标必须使用盈亏绿，不得用 Linear Done 靛蓝')
  assert(statusIcon.includes("loss: 'var(--status-canceled)'"), '亏损状态图标应使用 Canceled 色而非盈亏红')
}
