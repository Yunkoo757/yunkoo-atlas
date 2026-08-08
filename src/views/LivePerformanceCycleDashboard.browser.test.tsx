import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'

declare global {
  interface Window {
    __livePerformanceCycleDashboardTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

async function waitForFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await waitForFrame()
}

function addDays(dayKey: string, amount: number): string {
  const date = parseLocalDate(dayKey)
  date.setDate(date.getDate() + amount)
  return formatYmd(date)
}

function weekStartFor(dayKey: string): string {
  const date = parseLocalDate(dayKey)
  const distance = (date.getDay() + 6) % 7
  return addDays(dayKey, -distance)
}

const strategies: Strategy[] = [
  { id: 'first-strategy', name: '突破策略', icon: 'target', color: '#5e6ad2' },
  { id: 'second-strategy', name: '回踩策略', icon: 'target', color: '#8b5cf6' },
]

function closedTrade(
  id: string,
  pnl: number,
  closedTradingDayKey: string,
  strategyId: string,
  patch: Partial<Trade> = {},
): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId,
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: closedTradingDayKey,
    closedAt: closedTradingDayKey,
    closedTradingDayKey,
    note: '',
    ...patch,
  }
}

function buildFixture() {
  const tradingDayStartHour = useStore.getState().display.tradingDayStartHour
  const currentDay = getTradingDayKey(new Date(), tradingDayStartHour)
  const currentWeekStart = weekStartFor(currentDay)
  const historicalDay = addDays(currentWeekStart, -1)
  const cycles: LivePerformanceCycle[] = [
    {
      id: 'cycle-one',
      name: '第一期',
      startTradingDayKey: '2000-01-01',
      createdAt: '2000-01-01T00:00:00.000Z',
    },
    {
      id: 'cycle-two',
      name: '第二期',
      startTradingDayKey: currentWeekStart,
      createdAt: `${currentWeekStart}T00:00:00.000Z`,
    },
  ]
  const firstCycle = closedTrade('cycle-one', 100, historicalDay, strategies[0]!.id)
  const secondCycle = closedTrade('cycle-two', 150, currentDay, strategies[1]!.id)
  const crossBoundary = closedTrade('cross-boundary', 100, currentDay, strategies[1]!.id, {
    openedAt: historicalDay,
  })
  const paper = closedTrade('paper', 400, currentDay, strategies[1]!.id, {
    tradeKind: 'paper',
  })
  const copiedCase = closedTrade('copied-case', 999, historicalDay, strategies[0]!.id, {
    tradeKind: 'case',
    sourceTradeId: firstCycle.id,
    caseType: 'exemplar',
    recordedAt: currentDay,
  })
  const missed: Trade = {
    ...closedTrade('missed', 0, currentDay, strategies[1]!.id),
    status: 'missed',
    exit: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    missReason: 'hesitation',
    reviewStatus: 'unreviewed',
  }
  return {
    cycles,
    trades: [firstCycle, secondCycle, crossBoundary, paper, copiedCase, missed],
  }
}

function text(): string {
  return document.body.textContent ?? ''
}

async function selectCycle(label: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="统计周期"]')
  assert(trigger, '统计周期选择器未渲染')
  trigger.click()
  await waitFor(
    () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .some((option) => option.textContent?.trim() === label),
    `统计周期选项“${label}”未出现`,
  )
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((candidate) => candidate.textContent?.trim() === label)
  option?.click()
}

function mountDashboard(
  rootElement: HTMLElement,
  initialEntry: string,
): { root: Root; router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter([
    { path: '/dashboard', element: <Dashboard /> },
    { path: '/list', element: <div>交易日志</div> },
  ], { initialEntries: [initialEntry] })
  const root = createRoot(rootElement)
  root.render(<RouterProvider router={router} />)
  return { root, router }
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const fixture = buildFixture()
  let mounted: ReturnType<typeof mountDashboard> | null = null

  try {
    useStore.setState({
      trades: fixture.trades,
      strategies,
      livePerformanceCycles: fixture.cycles,
    })
    mounted = mountDashboard(rootElement, '/dashboard')

    await waitFor(() => text().includes('当前统计周期 · 第二期'), '默认实盘必须显示当前统计周期')
    assert(text().includes('+$250'), '默认实盘主聚合必须只统计第二期并按平仓日纳入跨界交易')
    assert(!text().includes('+$999'), '从实盘复制的案例不得进入仪表盘聚合')
    assert(
      document.querySelector('button[role="combobox"][aria-label="统计周期"]')?.getAttribute('data-value') === 'cycle-two',
      '选择器必须解析到当前周期',
    )

    await selectCycle('第一期')
    await waitFor(
      () => mounted?.router.state.location.search.includes('statsCycle=cycle-one') === true,
      '历史周期没有写入 URL',
    )
    assert(mounted.router.state.location.search.includes('range=all'), '选择周期必须把时间范围重置为全部')
    await waitFor(() => text().includes('当前统计周期 · 第一期'), '历史周期范围标识没有更新')
    assert(text().includes('+$100'), '历史周期主聚合必须只统计第一期')
    assert(text().includes('错过 1'), '历史周期不得截断当前自然周的错过机会')
    assert(text().includes('执行缺口：犹豫未进 ×1'), '自然周错过原因汇总必须保持不变')
    const cycleTradeHref = document
      .querySelector<HTMLAnchorElement>('[data-cycle-trade-link]')
      ?.getAttribute('href')
    assert(cycleTradeHref?.includes('statsCycle=cycle-one'), '查看本周期交易链接必须使用同一历史周期')
    const strategyHref = document.querySelector<HTMLAnchorElement>('a.db-strat')?.getAttribute('href')
    assert(strategyHref?.includes('statsCycle=cycle-one'), '策略下钻链接必须使用同一历史周期')

    mounted.root.unmount()
    mounted = mountDashboard(rootElement, '/dashboard?kind=paper&range=all')
    await waitFor(() => text().includes('+$400'), '模拟盘原有全历史合计被实盘周期污染')
    assert(!document.querySelector('button[role="combobox"][aria-label="统计周期"]'), '模拟盘必须隐藏统计周期选择器')
    assert(!text().includes('当前统计周期 ·'), '模拟盘必须隐藏统计周期范围标识')

    mounted.root.unmount()
    mounted = mountDashboard(rootElement, '/dashboard?kind=all&range=all')
    await waitFor(() => text().includes('+$750'), '全部交易原有全历史合计被实盘周期污染')
    assert(!document.querySelector('button[role="combobox"][aria-label="统计周期"]'), '全部交易必须隐藏统计周期选择器')

    mounted.root.unmount()
    mounted = mountDashboard(rootElement, '/dashboard?kind=live&statsCycle=missing')
    let replaceCount = 0
    const unsubscribe = mounted.router.subscribe((state) => {
      if (state.historyAction === 'REPLACE') replaceCount += 1
    })
    await waitFor(
      () => !mounted?.router.state.location.search.includes('statsCycle'),
      '无效统计周期没有规范化为当前周期',
    )
    await waitForFrames(4)
    unsubscribe()
    assert(replaceCount === 1, `无效统计周期必须且只能 replace 一次，实际 ${replaceCount} 次`)
    assert(text().includes('当前统计周期 · 第二期'), '无效统计周期必须回退当前周期')

    mounted.root.unmount()
    useStore.setState({ livePerformanceCycles: [] })
    mounted = mountDashboard(rootElement, '/dashboard')
    await waitFor(() => text().includes('+$350'), '无周期集合必须保留实盘全历史统计')
    assert(text().includes('开始新统计周期'), '无周期集合必须显示创建入口')
    assert(!document.querySelector('button[role="combobox"][aria-label="统计周期"]'), '无周期集合不得显示空选择器')
  } finally {
    mounted?.root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      livePerformanceCycles: previous.livePerformanceCycles,
    })
  }
}

window.__livePerformanceCycleDashboardTest = run()
