import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'
import { getTradingDayKey } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { DetailView } from '@/views/DetailView'
import { PeriodPage, TradeLogPage } from '@/App'

declare global {
  interface Window {
    __dashboardAnalysisScopeTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 240; index += 1) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

const strategy: Strategy = {
  id: 'breakout',
  name: '突破',
  icon: 'target',
  color: '#5e6ad2',
}

const stages: LiveStage[] = [
  {
    id: 'stage-old',
    sequence: 1,
    name: '历史阶段',
    status: 'archived',
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'stage-current',
    sequence: 2,
    name: '当前阶段',
    status: 'current',
    startsOn: '2026-02-01',
    endsOn: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    archivedAt: null,
  },
]

function liveTrade(id: string, stageId: string, pnl: number, day: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'live',
    liveStageId: stageId,
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
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
  }
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  let root = createRoot(element)
  const historicalWithFutureDate = liveTrade('historical', 'stage-old', 900, '2000-01-02')
  const currentWithOldDate = liveTrade('current', 'stage-current', 100, '2000-01-01')

  try {
    useStore.setState({
      trades: [historicalWithFutureDate, currentWithOldDate],
      strategies: [strategy],
      liveStages: stages,
      currentLiveStageId: 'stage-current',
    })
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all&liveStage=stage-old&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all&liveStage=stage-old&symbol=BTCUSDT',
      '统计分析必须保留用户选择的盘型与历史阶段',
    )
    await waitFor(() => document.body.textContent?.includes('+$900') ?? false, 'Dashboard 必须统计所选历史 stage 的已编辑事实')
    assert(!document.body.textContent?.includes('+$100'), '当前 stage 不得混入历史阶段 Dashboard')
    assert(!document.body.textContent?.includes('+$1,000'), 'legacy 周期不得重新合并跨 stage 数据')
    const currentRangeHeading = document.querySelector<HTMLElement>('[data-dashboard-current-range]')
    const weekContext = document.querySelector<HTMLElement>('[aria-label="本周交易分析"]')
    assert(currentRangeHeading && weekContext, 'Dashboard 必须同时标明当前分析范围与本周上下文')
    assert(Boolean(currentRangeHeading.compareDocumentPosition(weekContext) & Node.DOCUMENT_POSITION_FOLLOWING), '当前分析范围标题必须先于本周上下文')

    const currentLink = document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')
    assert(currentLink?.getAttribute('href') === '/list?kind=live&range=all&liveStage=stage-old', '查看交易必须携带所选历史 stage')
    const strategyLink = document.querySelector<HTMLAnchorElement>('a.db-strat')
    assert(strategyLink?.getAttribute('href') === '/strategy/breakout?kind=live&range=all&liveStage=stage-old', '策略下钻必须携带所选历史 stage')
    const kpi = document.querySelector<HTMLAnchorElement>('[data-kpi-drilldown]')
    assert(kpi?.getAttribute('href') === '/list?kind=live&range=all&liveStage=stage-old', 'KPI 下钻必须携带同一历史 stage')

    kpi.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/list?kind=live&range=all&liveStage=stage-old', 'KPI 下钻没有保留 stage URL')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, 'KPI 下钻必须与 Dashboard 历史 stage 集合一致')
    assert(document.querySelector('[data-trade-id="historical"]'), '下钻列表必须显示历史 stage 记录')
    assert(!document.querySelector('[data-trade-id="current"]'), '下钻列表不得显示当前 stage 记录')

    document.querySelector<HTMLButtonElement>('[aria-label="打开 BTCUSDT TRD-historical"]')?.click()
    await waitFor(() => Boolean(document.querySelector('[aria-label="返回列表"]')), '历史 stage 行必须继续使用原详情路径')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回列表"]')?.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/list?kind=live&range=all&liveStage=stage-old', '详情返回必须恢复历史 stage 与过滤查询')

    const currentDay = getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour)
    const usdLive = liveTrade('currency-usd', 'stage-current', 100, currentDay)
    const cnyLive = { ...liveTrade('currency-cny', 'stage-current', 900, currentDay), cashCurrency: 'CNY' } satisfies Trade
    const unknownLive = { ...liveTrade('currency-unknown', 'stage-current', 50, currentDay), cashCurrency: null } satisfies Trade
    root.unmount()
    useStore.setState({
      trades: [usdLive, cnyLive, unknownLive],
      profile: { ...useStore.getState().profile, legacyCashCurrencyAssumption: null },
    })
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all&liveStage=current']}>
        <Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('[data-currency-merge-status="usd-with-exclusions"]')), '混合/未知币种必须显示独立覆盖状态')
    const currencyHealth = document.querySelector('[data-currency-merge-status]')?.textContent ?? ''
    assert(currencyHealth.includes('USD 覆盖 1/3 笔'), 'Dashboard 必须显示 USD 覆盖数量')
    assert(currencyHealth.includes('CNY 1 笔') && currencyHealth.includes('币种未知 1 笔'), 'Dashboard 必须解释被排除币种与 unknown')
    assert(document.body.textContent?.includes('+$100'), 'Dashboard 净盈亏只能合并 USD')
    assert(!document.body.textContent?.includes('+$1,050'), 'Dashboard 不得把不同币种相加')

    const openLive = {
      ...liveTrade('open-current', 'stage-current', 0, currentDay),
      status: 'open',
      exit: null,
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
      closedAt: null,
      closedTradingDayKey: undefined,
    } satisfies Trade
    root.unmount()
    useStore.setState({ trades: [openLive] })
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=this-week&liveStage=current']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some((button) => button.textContent?.trim() === '查看进行中交易'), '当前 stage 只有持仓时必须显示查看进行中交易空状态')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '查看进行中交易')?.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/list?view=active', '空状态按钮必须打开同一上下文的进行中交易')

    root.unmount()
    useStore.setState({ trades: [usdLive] })
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all&liveStage=current&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/trade/:id" element={<><DetailView /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('summary')), 'Dashboard 必须提供累计盈亏数据表入口')
    document.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await waitFor(() => Boolean(document.querySelector<HTMLAnchorElement>('a[href="/trade/TRD-currency-usd"]')), 'Dashboard 数据表必须提供详情链接')
    document.querySelector<HTMLAnchorElement>('a[href="/trade/TRD-currency-usd"]')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-back')), 'Dashboard 交易详情必须显示返回入口')
    document.querySelector<HTMLAnchorElement>('.dv-back')?.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all&liveStage=current&symbol=BTCUSDT', 'Dashboard 详情返回必须恢复 stage、range 与过滤查询')

    root.unmount()
    useStore.setState({ trades: [usdLive] })
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=ytd&liveStage=current']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('[data-kpi-drilldown]')), '本年 Dashboard 必须显示 KPI 下钻')
    const ytdDrilldown = document.querySelector<HTMLAnchorElement>('[data-kpi-drilldown]')
    assert(ytdDrilldown?.getAttribute('href') === '/list?kind=live&range=ytd', '本年下钻必须保留 YTD；当前阶段使用默认语义')
    ytdDrilldown.click()
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '本年下钻列表必须与 Dashboard stage 集合一致')
    assert(document.querySelector('[data-trade-id="currency-usd"]'), '本年下钻必须显示同一当前 stage 交易')

    root.unmount()
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/period/ytd']}>
        <Routes><Route path="/period/:slug" element={<><PeriodPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => document.querySelector('h1')?.textContent === '本年' && document.querySelectorAll('[data-trade-id]').length === 1, '/period/ytd 必须保留本年标题与真实列表')
    assert(document.querySelector('[data-testid="location"]')?.textContent === '/period/ytd', '/period/ytd 不得静默跳转到 today')
    root.unmount()
    root = createRoot(element)
    root.render(
      <MemoryRouter initialEntries={['/period/bad/board?symbol=BTCUSDT']}>
        <Routes><Route path="/period/:slug/board" element={<><PeriodPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('[data-invalid-period]')), '非法 period slug 必须显示可解释恢复页')
    assert(document.body.textContent?.includes('/period/bad/board?symbol=BTCUSDT'), '恢复页必须保留并解释原始 pathname/query')
    assert(document.querySelector('[data-testid="location"]')?.textContent === '/period/bad/board?symbol=BTCUSDT', '非法 period 不得静默跳转或丢失 board/query')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      profile: previous.profile,
    })
  }
}

window.__dashboardAnalysisScopeTest = run()
