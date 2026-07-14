function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testCommandPaletteUsesActiveWorkspaceTagFilters(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/CommandPalette.tsx', 'utf8')

  assert(
    source.includes('trades.filter((trade) => !trade.deletedAt)'),
    '命令面板不得搜索回收站记录',
  )
  for (const route of ["path: '/list'", "path: '/sim'", "path: '/review-cases'"]) {
    assert(source.includes(route), `标签命令缺少工作区路由：${route}`)
  }
  assert(
    source.includes('new URLSearchParams({ tag }).toString()'),
    '标签命令应通过 URL 筛选进入对应工作区',
  )
  assert(
    !source.includes('run: first ? go(tradeDetailPath(first))'),
    '标签命令不得再打开任意第一条记录',
  )
}

export async function testSmallInteractionCopyAndContrastContracts(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [menu, actions, display, profileCss, tokens] = await Promise.all([
    fs.readFile('src/lib/tradeMenu.tsx', 'utf8'),
    fs.readFile('src/shortcuts/actions.ts', 'utf8'),
    fs.readFile('src/views/settings/DisplaySettingsPanel.tsx', 'utf8'),
    fs.readFile('src/views/settings/ProfileSettingsPanel.css', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
  ])

  assert(!menu.includes("hint: 'E'"), '未实现的编辑快捷键不得出现在右键菜单')
  assert(actions.includes("label: '上一条记录'"), '上一条动作应使用通用记录文案')
  assert(actions.includes("label: '下一条记录'"), '下一条动作应使用通用记录文案')
  assert(!actions.includes("label: '上一个案例'"), '交易详情不得继续使用案例专属文案')
  assert(display.includes('顶栏「显示」与此处共用同一组偏好'), '显示设置应说明真实持久化边界')
  assert(!display.includes('临时调整当前视图'), '显示设置不得暗示修改仅临时生效')
  assert(
    profileCss.includes('.profile-avatar-item.is-selected .profile-avatar-label') &&
      profileCss.includes('color: var(--text-primary);'),
    '选中头像标签应使用足够对比度',
  )

  const inter = tokens.indexOf('"Inter Variable"')
  const cjk = tokens.indexOf('"PingFang SC"', inter)
  const westernFallback = tokens.indexOf('Inter, -apple-system', inter)
  assert(inter >= 0 && cjk > inter && westernFallback > cjk, '字体栈应保留 Inter Variable 首位，并优先使用 CJK 系统回退')
}
