function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

import { collectLimitedCommandMatches } from './commandPaletteSearch'

export function testCommandPaletteFiltersBeforeProjectingCappedResults(): void {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    label: `交易 ${index}`,
  }))
  let projected = 0

  const result = collectLimitedCommandMatches(
    candidates,
    '交易',
    (candidate) => [candidate.label],
    (candidate) => {
      projected += 1
      return candidate.id
    },
    12,
  )

  assert(result.total === 100, '命令面板应保留总匹配数用于截断提示')
  assert(result.items.length === 12, '命令面板搜索结果应遵守明确上限')
  assert(projected === 12, '命令面板应先过滤和截断，再创建命令对象')

  const empty = collectLimitedCommandMatches(
    candidates,
    '   ',
    (candidate) => [candidate.label],
    (candidate) => {
      projected += 1
      return candidate.id
    },
    12,
  )
  assert(empty.total === 0 && empty.items.length === 0, '空查询不得构造动态搜索结果')
  assert(projected === 12, '空查询不得投影任何动态命令')
}

export async function testCommandPaletteUsesActiveWorkspaceTagFilters(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/CommandPalette.tsx', 'utf8')

  const closedGate = source.indexOf('if (!open) return null')
  const mountedDialog = source.indexOf('function CommandPaletteDialog')
  const storeSubscription = source.indexOf('useStore((s) => s.trades)')
  assert(
    closedGate >= 0 && closedGate < mountedDialog && mountedDialog < storeSubscription,
    '命令面板关闭时不得挂载 store 订阅或构造动态命令',
  )
  assert(
    source.includes('const MAX_SEARCH_RESULTS = 60'),
    '命令面板动态搜索应设置明确的全局结果上限',
  )

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

export async function testTodayNavigationAndDateBoundaryRemainInsideTheWorkspace(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [today, visibleTrades] = await Promise.all([
    fs.readFile('src/views/TodayWorkspace.tsx', 'utf8'),
    fs.readFile('src/hooks/useWorkbenchVisibleTrades.ts', 'utf8'),
  ])

  assert(!today.includes('href={`#today-'), 'HashRouter 页面不得用 URL hash 承载页内滚动')
  assert(today.includes('scrollIntoView'), 'Today 概览应在当前工作区内滚动到目标队列')
  assert(today.includes('useLocalDateKey()'), 'Today 工作台应在本地午夜后自动换日')
  assert(
    visibleTrades.includes('useLocalDateKey()') && visibleTrades.includes('localDateKey,'),
    '今日筛选的 memo 必须随本地日期边界重新计算',
  )
}
