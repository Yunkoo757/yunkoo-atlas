import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { formatYmd, getTradingDayKey } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { DetailView } from '@/views/DetailView'

declare global {
  interface Window {
    __dashboardAnalysisScopeTest?: Promise<void>
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

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

const strategy: Strategy = {
  id: 'paper-strategy',
  name: '模拟策略',
  icon: 'target',
  color: '#5e6ad2',
}

const paperTrade: Trade = {
  id: 'paper-win',
  ref: 'TRD-PAPER',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: strategy.id,
  tradeKind: 'paper',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 250,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour),
  closedAt: getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour),
  note: '',
}

const openPaperTrade: Trade = {
  ...paperTrade,
  id: 'paper-open',
  ref: 'TRD-PAPER-OPEN',
  status: 'open',
  exit: null,
  pnl: null,
  rMultiple: null,
  resultSource: undefined,
  closedAt: null,
  reviewStatus: 'unreviewed',
}

const oldLiveTrade: Trade = {
  ...paperTrade,
  id: 'old-live',
  ref: 'TRD-OLD-LIVE',
  tradeKind: 'live',
  openedAt: '2000-01-01',
  closedAt: paperTrade.closedAt,
  pnl: 500,
}

const currentLiveTrade: Trade = {
  ...paperTrade,
  id: 'current-live',
  ref: 'TRD-CURRENT-LIVE',
  tradeKind: 'live',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  let root = createRoot(rootElement)

  try {
    useStore.setState({ trades: [paperTrade], strategies: [strategy] })
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=paper&range=this-week']}>
        <Routes>
          <Route
            path="/dashboard"
            element={<><Dashboard /><LocationProbe /></>}
          />
          <Route path="/strategy/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('a.db-strat')), '策略分析链接未出现')
    const selectedKind = [...document.querySelectorAll<HTMLButtonElement>('.db-seg')]
      .find((button) => button.textContent?.trim() === '模拟盘')
    const selectedRange = [...document.querySelectorAll<HTMLButtonElement>('.db-seg')]
      .find((button) => button.textContent?.trim() === '本周')
    assert(selectedKind?.getAttribute('aria-pressed') === 'true', '仪表盘必须从 URL 恢复交易类型')
    assert(selectedRange?.getAttribute('aria-pressed') === 'true', '仪表盘必须从 URL 恢复时间范围')
    assert(document.body.textContent?.includes('+$250'), '仪表盘必须使用 URL 范围内的模拟交易')

    const link = document.querySelector<HTMLAnchorElement>('a.db-strat')
    assert(
      link?.getAttribute('href') === '/strategy/paper-strategy?kind=paper&range=this-week',
      '策略下钻链接必须保留仪表盘范围',
    )
    link.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/strategy/paper-strategy?kind=paper&range=this-week',
      '进入策略页后分析范围丢失',
    )

    root.unmount()
    useStore.setState({ trades: [openPaperTrade] })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=paper&range=this-week']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/sim" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '查看进行中交易'),
      '有模拟持仓但无平仓记录时，应引导查看进行中交易',
    )
    const activeButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '查看进行中交易')
    activeButton?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/sim',
      '模拟范围的空状态应回到模拟交易工作区',
    )

    root.unmount()
    useStore.setState({
      trades: [oldLiveTrade, currentLiveTrade],
      liveStatsStartTradingDayKey: currentLiveTrade.openedAt,
    })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('a.db-strat')), '全历史策略统计未出现')
    assert(document.body.textContent?.includes('+$750'), '风险核算起点不得截断默认实盘与策略统计')

    // 此断言会捕捉 Dashboard 忘记把同一当前实盘范围传给主统计、周卡片、策略下钻或 all 范围的回归。
    const currentDay = getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour)
    const previousDay = new Date(`${currentDay}T12:00:00`)
    previousDay.setDate(previousDay.getDate() - 7)
    const oldDay = previousDay.toISOString().slice(0, 10)
    const cycles: LivePerformanceCycle[] = [
      { id: 'archive-cycle', name: '实盘-旧', startTradingDayKey: '2000-01-01', createdAt: '2000-01-01T00:00:00.000Z' },
      { id: 'current-cycle', name: '实盘-当前', startTradingDayKey: currentDay, createdAt: `${currentDay}T00:00:00.000Z` },
    ]
    const archivedLive: Trade = { ...oldLiveTrade, id: 'archived-live', ref: 'TRD-ARCHIVED', openedAt: oldDay, closedAt: oldDay, closedTradingDayKey: oldDay, pnl: 900 }
    const currentLive: Trade = { ...currentLiveTrade, id: 'current-live-stat', ref: 'TRD-CURRENT', openedAt: currentDay, closedAt: currentDay, closedTradingDayKey: currentDay, pnl: 100 }
    const historicalPaper: Trade = { ...paperTrade, id: 'historical-paper', ref: 'TRD-PAPER-HISTORY', openedAt: oldDay, closedAt: oldDay, closedTradingDayKey: oldDay, pnl: 50 }
    root.unmount()
    useStore.setState({ trades: [archivedLive, currentLive, historicalPaper], livePerformanceCycles: cycles })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<LocationProbe />} />
          <Route path="/strategy/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => document.body.textContent?.includes('当前实盘统计') ?? false, 'Dashboard 必须明确显示当前实盘统计')
    assert(document.body.textContent?.includes('+$100'), '主统计只能包含当前实盘交易')
    assert(!document.body.textContent?.includes('+$900'), '历史归档实盘不得混入当前主统计')
    assert(document.body.textContent?.includes('历史归档'), 'Dashboard 必须提供历史归档入口')
    assert(!document.body.textContent?.includes('绩效阶段'), 'Dashboard 不得暴露实现术语')
    const currentHref = document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')?.getAttribute('href')
    assert(currentHref === '/list?kind=live&range=all', `查看当前实盘必须只进入当前范围，实际 ${currentHref}`)

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all&statsCycle=current&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all&symbol=BTCUSDT',
      'Dashboard 必须移除显式当前周期参数并保留无关筛选',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all&liveCycle=pre-cycle&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all&symbol=BTCUSDT',
      'Dashboard 必须移除风险周期别名并保留无关筛选',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => document.querySelector('summary') !== null, 'Dashboard 累计盈亏数据表入口未出现')
    document.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => document.querySelector<HTMLAnchorElement>('a[href="/trade/TRD-CURRENT"]') !== null,
      'Dashboard 数据表未提供交易详情入口',
    )
    document.querySelector<HTMLAnchorElement>('a[href="/trade/TRD-CURRENT"]')?.click()
    await waitFor(() => document.querySelector('[aria-label="返回列表"]') !== null, '交易详情未显示返回入口')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回列表"]')?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all',
      '从 Dashboard 当前范围进入详情再返回时不得回退列表或丢失分析查询',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&statsCycle=archive-cycle&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/live-archive" element={<LocationProbe />} />
          <Route path="/live-archive/:archiveId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/live-archive/archive-cycle?kind=live&symbol=BTCUSDT',
      '历史归档深链不得静默展示当前 Dashboard，必须安全转到历史归档入口',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=all&range=all']}>
        <Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => document.body.textContent?.includes('+$150') ?? false, '全部范围必须保留全部模拟盘且只包含当前实盘')
    assert(!document.body.textContent?.includes('+$1,050'), '全部范围不得把历史归档实盘重新混入统计')

    root.unmount()
    const weekStart = weekStartFor(new Date(`${currentDay}T12:00:00`))
    const currentCycleStartDate = new Date(`${weekStart}T12:00:00`)
    currentCycleStartDate.setDate(currentCycleStartDate.getDate() + 1)
    const currentCycleStart = formatYmd(currentCycleStartDate)
    const archivedMissed: Trade = {
      ...currentLiveTrade,
      id: 'archived-missed',
      status: 'missed',
      closedAt: weekStart,
      closedTradingDayKey: weekStart,
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
    }
    const currentMissed: Trade = {
      ...currentLiveTrade,
      id: 'current-missed',
      status: 'missed',
      closedAt: currentCycleStart,
      closedTradingDayKey: currentCycleStart,
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
    }
    useStore.setState({
      trades: [archivedMissed, currentMissed],
      livePerformanceCycles: [
        { id: 'week-archive', name: '周旧', startTradingDayKey: '2000-01-01', createdAt: '2000-01-01T00:00:00.000Z' },
        { id: 'week-current', name: '周当前', startTradingDayKey: currentCycleStart, createdAt: `${currentCycleStart}T00:00:00.000Z` },
      ],
    })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all']}>
        <Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => document.body.textContent?.includes('错过 1') ?? false, '本周错过机会必须只统计当前实盘周期')
    assert(!document.body.textContent?.includes('错过 2'), '旧周期本周错过机会不得混入当前实盘周卡片')

    root.unmount()
    const missingCloseLive: Trade = {
      ...currentLiveTrade,
      id: 'missing-close-live',
      openedAt: currentDay,
      closedAt: null,
      pnl: 777,
    }
    useStore.setState({ trades: [missingCloseLive], livePerformanceCycles: [] })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all']}>
        <Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('.db-empty')), '无可靠平仓日的实盘结果应从无周期 KPI 移除')
    assert(!document.body.textContent?.includes('+$777'), '无周期实盘 KPI 不得从 openedAt 回退纳入结果')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
      livePerformanceCycles: previous.livePerformanceCycles,
    })
  }
}

window.__dashboardAnalysisScopeTest = run()
