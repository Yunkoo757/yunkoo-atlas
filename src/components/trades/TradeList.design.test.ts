function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListGroupTogglePreservesInteractionContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/trades/TradeList.tsx', 'utf8')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')
  const statusIcon = await fs.readFile('src/components/StatusIcon.tsx', 'utf8')

  assert(source.includes('aria-expanded={item.openProgress > 0.5}'), '分组头必须暴露 aria-expanded')
  assert(source.includes('animateGroupTo'), '分组开合必须走动画进度，而非瞬间删行')
  assert(source.includes('EASE_OUT_QUART'), '折叠缓动必须使用统一 ease-out-quart')
  assert(source.includes('COLLAPSE_MS'), '折叠时长必须使用统一布局动效')
  assert(source.includes('ROW_HEIGHT * item.openProgress'), '行高必须随 openProgress 平滑收展')
  assert(source.includes('DisclosureChevron'), '分组折叠必须使用语义化 DisclosureChevron')
  assert(source.includes('StatusIndicator'), '复盘分组头应使用语义化状态图标')
  assert(source.includes('rotate(${90 * item.openProgress}deg)'), '展开时箭头应从朝右旋至朝下')
  assert(css.includes('will-change: transform'), '三角旋转应开启合成层以保证流畅')
  assert(css.includes('--trade-group-chevron'), '分组三角应按状态/远近 tint，而非整条换底色')
  assert(
    css.includes('.trade-list-group-toggle:hover .trade-list-group-chevron') &&
      css.includes('lch(100% 0 272 / 1)'),
    '分组三角悬停应保持清晰的纯白高亮',
  )
  assert(tokens.includes('--group-chevron-started:'), '当前状态三角色必须使用专用色值')
  assert(tokens.includes('--status-completed: var(--pos);'), '盈利完成态色应对齐盈亏绿')
  assert(tokens.includes('--neg:'), '必须保留盈亏红色令牌')
  assert(statusIcon.includes("win: 'var(--pos)'"), '盈利状态图标必须使用盈亏绿')
  assert(statusIcon.includes("loss: 'var(--neg)'"), '亏损状态图标必须使用盈亏红')
}
