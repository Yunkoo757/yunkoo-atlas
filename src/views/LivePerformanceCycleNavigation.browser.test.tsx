import { createRoot, type Root } from 'react-dom/client'
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useParams,
} from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { StrategyHeader } from '@/components/StrategyHeader'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { parseAnalysisScope } from '@/lib/analysisScope'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { ListView } from '@/views/ListView'

declare global {
  interface Window {
    __livePerformanceCycleNavigationTest?: Promise<void>
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

function addDays(dayKey: string, amount: number): string {
  const date = parseLocalDate(dayKey)
  date.setDate(date.getDate() + amount)
  return formatYmd(date)
}

const strategy: Strategy = {
  id: 'shared-strategy',
  name: '共享突破策略',
  icon: 'target',
  color: '#5e6ad2',
}

function closedTrade(id: string, pnl: number, day: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
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
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
  }
}

function buildFixture() {
  const tradingDayStartHour = useStore.getState().display.tradingDayStartHour
  const currentDay = getTradingDayKey(new Date(), tradingDayStartHour)
  const secondStart = addDays(currentDay, -10)
  const cycles: LivePerformanceCycle[] = [
    {
      id: 'cycle-one-real-id',
      name: '第一期',
      startTradingDayKey: '2000-01-01',
      createdAt: '2000-01-01T00:00:00.000Z',
    },
    {
      id: 'cycle-two-real-id',
      name: '第二期',
      startTradingDayKey: secondStart,
      createdAt: `${secondStart}T00:00:00.000Z`,
    },
  ]
  return {
    cycles,
    thirdCycle: {
      id: 'cycle-three-real-id',
      name: '第三期',
      startTradingDayKey: currentDay,
      createdAt: `${currentDay}T00:00:00.000Z`,
    } satisfies LivePerformanceCycle,
    trades: [
      closedTrade('historical-member', 100, addDays(secondStart, -1)),
      closedTrade('second-member', 150, addDays(secondStart, 1)),
      closedTrade('future-third-member', 50, currentDay),
    ],
  }
}

function StrategyPage() {
  const { id = '' } = useParams()
  const { search } = useLocation()
  const parsed = parseAnalysisScope(search)
  const analysisScope = parsed.explicit ? parsed.scope : undefined
  const filter = analysisScope
    ? { type: 'strategy' as const, strategyId: id, analysisScope }
    : { type: 'strategy' as const, strategyId: id, tradeKind: 'live' as const }
  return (
    <ListView
      title={strategy.name}
      view="list"
      onView={() => undefined}
      filter={filter}
      header={<StrategyHeader strategyId={id} analysisScope={analysisScope} search={search} />}
    />
  )
}

function TradeListPage() {
  return (
    <div className="navigation-test-shell">
      <Sidebar />
      <main className="navigation-test-main">
        <ListView
          title="交易日志"
          view="list"
          onView={() => undefined}
          filter={{ type: 'all', tradeKind: 'live' }}
        />
      </main>
    </div>
  )
}

function visibleTradeIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
    .map((row) => row.dataset.tradeId ?? '')
    .filter(Boolean)
    .sort()
}

async function selectCycle(label: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[role="combobox"][aria-label="统计周期"]',
  )
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

function clickLink(selector: string, message: string): void {
  const link = document.querySelector<HTMLAnchorElement>(selector)
  assert(link, message)
  link.click()
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const fixture = buildFixture()
  let root: Root | null = null

  try {
    useStore.setState({
      trades: fixture.trades,
      strategies: [strategy],
      livePerformanceCycles: fixture.cycles,
      display: {
        ...previous.display,
        hideClosed: false,
        groupByDate: false,
        groupByStrategy: false,
        workspaceMemory: undefined,
      },
    })

    const router = createMemoryRouter([
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/strategy/:id', element: <StrategyPage /> },
      { path: '/list', element: <TradeListPage /> },
    ], { initialEntries: ['/dashboard'] })
    root = createRoot(rootElement)
    root.render(<RouterProvider router={router} />)

    await waitFor(() => document.body.textContent?.includes('当前统计周期 · 第二期') === true, 'Dashboard 未进入当前周期')
    await selectCycle('第一期')
    await waitFor(() => router.state.location.search.includes('statsCycle=cycle-one-real-id'), '历史周期没有写入 Dashboard URL')
    clickLink('a.db-strat', 'Dashboard 没有可下钻的真实策略行')
    await waitFor(() => router.state.location.pathname === `/strategy/${strategy.id}`, '没有进入真实策略页')

    const strategyHeader = document.querySelector<HTMLElement>('.sh')
    assert(strategyHeader, '真实策略页必须渲染统计头部')
    assert(strategyHeader.textContent?.includes('1 笔已平'), '历史周期策略总数必须与 Dashboard 子集一致')
    assert(strategyHeader.textContent.includes('+$100'), '历史周期策略盈亏必须与 Dashboard 子集一致')

    await router.navigate(-1)
    await waitFor(() => router.state.location.pathname === '/dashboard', '无法返回 Dashboard')
    await waitFor(
      () => Boolean(document.querySelector('[data-cycle-trade-link]')),
      '返回 Dashboard 后周期交易链接没有恢复',
    )
    clickLink('[data-cycle-trade-link]', 'Dashboard 缺少“查看本周期交易”链接')
    await waitFor(() => router.state.location.pathname === '/list', '没有进入真实交易列表')
    await router.navigate(
      '/list?statsCycle=cycle-one-real-id&symbol=BTCUSDT',
      { replace: true },
    )
    await waitFor(
      () => Boolean(document.querySelector('[aria-label="移除 BTCUSDT"]')),
      '无关品种筛选没有完成渲染',
    )
    await waitFor(() => visibleTradeIds().length === 1, '历史周期列表没有收敛到精确成员')
    assert(visibleTradeIds().join(',') === 'historical-member', '历史周期交易列表包含了区间外交易')
    assert(document.body.textContent?.includes('统计周期：第一期'), '交易列表必须显示可读的统计周期标签')

    const clearHistorical = document.querySelector<HTMLButtonElement>('[aria-label="移除 统计周期：第一期"]')
    assert(clearHistorical, '统计周期标签必须提供一键清除动作')
    clearHistorical.click()
    await waitFor(() => !router.state.location.search.includes('statsCycle'), '清除动作没有只移除 statsCycle')
    assert(router.state.location.search.includes('symbol=BTCUSDT'), '清除统计周期不得丢失无关筛选')
    await waitFor(() => visibleTradeIds().length === 3, '清除周期后没有恢复原有未筛选交易列表')

    await router.navigate('/dashboard')
    await waitFor(() => document.body.textContent?.includes('当前统计周期 · 第二期') === true, '无法恢复当前周期 Dashboard')
    clickLink('[data-cycle-trade-link]', '当前周期缺少交易下钻链接')
    await waitFor(() => router.state.location.pathname === '/list', '当前周期没有进入交易列表')
    assert(
      router.state.location.search.includes('statsCycle=cycle-two-real-id'),
      '当前周期交易链接必须保留显式真实 ID，不能沿用 Dashboard 的省略形式',
    )
    await waitFor(() => visibleTradeIds().length === 2, '当前周期列表必须显示第二期的两个精确成员')

    useStore.setState({ livePerformanceCycles: [...fixture.cycles, fixture.thirdCycle] })
    await waitFor(() => visibleTradeIds().join(',') === 'second-member', '新建周期后旧显式 URL 必须继续锁定原周期区间')
    assert(router.state.location.search.includes('statsCycle=cycle-two-real-id'), '创建新周期不得改写既有显式列表 URL')

    useStore.setState({ livePerformanceCycles: [fixture.cycles[0]!, fixture.thirdCycle] })
    await waitFor(() => !router.state.location.search.includes('statsCycle'), '移除目标 ID 后必须只清除 statsCycle')
    assert(!router.state.location.search.includes('cycle-three-real-id'), '失效列表 ID 不得漂移到新的当前周期')
    await waitFor(() => visibleTradeIds().length === 3, '失效 ID 清除后必须恢复未筛选列表')

    useStore.setState({ livePerformanceCycles: fixture.cycles })
    await router.navigate('/list?statsCycle=cycle-one-real-id&liveCycle=pre-cycle&symbol=BTCUSDT')
    let replaceCount = 0
    const unsubscribe = router.subscribe((state) => {
      if (state.historyAction === 'REPLACE') replaceCount += 1
    })
    await waitFor(() => !router.state.location.search.includes('liveCycle'), 'statsCycle 与 liveCycle 冲突时没有清除 liveCycle')
    unsubscribe()
    assert(replaceCount === 1, `冲突 URL 应只 replace 一次，实际 ${replaceCount} 次`)
    assert(router.state.location.search.includes('statsCycle=cycle-one-real-id'), '冲突规范化不得丢失统计周期')
    assert(router.state.location.search.includes('symbol=BTCUSDT'), '冲突规范化不得丢失无关筛选')
    await waitFor(() => visibleTradeIds().join(',') === 'historical-member', '冲突 URL 必须以统计周期为准')
    await waitFor(
      () => document.querySelector<HTMLElement>('[data-primary-id="trades"] .sb-item-count')?.textContent?.trim() === '1',
      '侧栏交易数量必须与统计周期后的可见列表一致',
    )
  } finally {
    root?.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      livePerformanceCycles: previous.livePerformanceCycles,
      display: previous.display,
    })
  }
}

window.__livePerformanceCycleNavigationTest = run()
