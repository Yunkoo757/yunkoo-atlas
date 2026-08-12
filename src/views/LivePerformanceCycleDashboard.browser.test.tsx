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
    cashCurrency: 'USD',
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

function pressKey(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function assertNoRiskCycleCopy(context: string): void {
  assert(!text().includes('风险核算周期'), `${context}不得把绩效统计周期写成“风险核算周期”`)
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
    useStore.setState({ trades: fixture.trades, strategies, livePerformanceCycles: fixture.cycles })
    mounted = mountDashboard(rootElement, '/dashboard')
    await waitFor(() => text().includes('当前实盘统计'), '默认必须显示当前实盘统计')
    assert(text().includes('+$250'), '主统计只应包含当前实盘及跨边界平仓交易')
    assert(document.querySelector('[aria-label="本周交易分析"] .db-week-metric strong')?.textContent === '2', '本周卡片必须复用当前实盘范围')
    assert(!document.querySelector('button[role="combobox"]'), 'Dashboard 不得提供统计周期选择器')
    assert(text().includes('历史记录'), 'Dashboard 必须提供历史记录入口')
    assert(!text().includes('绩效阶段'), 'Dashboard 不得暴露绩效阶段术语')
    assert(document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')?.getAttribute('href') === '/list?kind=live&range=all', '当前实盘链接必须跟随当前范围')
    assert(document.querySelector<HTMLAnchorElement>('a.db-strat')?.getAttribute('href')?.includes('statsCycle=') === false, '策略下钻不得固定历史归档 ID')

    mounted.root.unmount()
    mounted = mountDashboard(rootElement, '/dashboard?kind=all&range=all')
    await waitFor(() => text().includes('+$250'), 'kind=all 纠偏后仍只统计当前实盘')
    assert(!text().includes('+$650'), '仪表盘不得再把模拟盘并入主统计')
    assert(!text().includes('+$750'), '不得混入历史归档实盘')
    assert(text().includes('当前实盘统计'), '纠偏后仍必须说明实盘统计采用当前范围')
    assert(
      ![...document.querySelectorAll('.db-range-control button')].some((button) => button.textContent?.includes('模拟盘')),
      '仪表盘不得再提供模拟盘切换',
    )

    const missingCloseDay = closedTrade('missing-close-day', 50, getTradingDayKey(new Date(), previous.display.tradingDayStartHour), strategies[0]!.id, { closedAt: 'invalid', closedTradingDayKey: undefined })
    const missedMissingCloseDay = closedTrade('missed-missing-close-day', 0, getTradingDayKey(new Date(), previous.display.tradingDayStartHour), strategies[0]!.id, {
      status: 'missed',
      exit: null,
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
      closedAt: 'invalid',
      closedTradingDayKey: undefined,
      missReason: 'hesitation',
      reviewStatus: 'unreviewed',
    })
    mounted.root.unmount()
    useStore.setState({ trades: [missingCloseDay, missedMissingCloseDay] })
    mounted = mountDashboard(rootElement, '/dashboard?kind=live&range=all')
    await waitFor(() => text().includes('待整理 1'), '绩效待整理必须只包含已执行平仓且缺少可靠日期的记录')
    assert(!text().includes('待整理 2'), 'missed 属于机会复盘，不得进入现金绩效待整理')

    const resultConflict = closedTrade('result-conflict', 50, getTradingDayKey(new Date(), previous.display.tradingDayStartHour), strategies[0]!.id, { status: 'loss', rMultiple: 1, resultSource: 'imported' })
    mounted.root.unmount()
    useStore.setState({ trades: [resultConflict], livePerformanceCycles: fixture.cycles })
    mounted = mountDashboard(rootElement, '/dashboard?kind=live&range=all')
    await waitFor(() => text().includes('1 笔结果冲突'), '结果冲突必须继续显示独立的数据健康提示')

    mounted.root.unmount()
    useStore.setState({ trades: [], livePerformanceCycles: [] })
    mounted = mountDashboard(rootElement, '/dashboard?kind=live&range=all')
    await waitFor(() => text().includes('还没有已平仓交易'), '无周期且无已平仓交易必须保留通用空状态')
    const moreActions = document.querySelector<HTMLButtonElement>('[aria-label="更多统计操作"]')
    assert(moreActions, '无周期时必须保留统计管理入口')
    moreActions.click()
    await waitFor(() => text().includes('管理统计周期'), '统计管理动作必须进入溢出菜单')
    const manage = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.trim() === '管理统计周期')
    assert(manage, '溢出菜单必须提供管理统计周期动作')
    manage.click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '统计管理动作必须打开对话框')
  } finally {
    mounted?.root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies, livePerformanceCycles: previous.livePerformanceCycles })
  }
}

window.__livePerformanceCycleDashboardTest = run()
