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
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { resolveLiveArchiveScope } from '@/lib/liveStatisticsArchive'
import { createBusinessDateAnchor } from '@/lib/periods'
import { PeriodPage, TradeLogPage } from '@/App'

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
  cashCurrency: 'USD',
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
    useStore.setState({ trades: [paperTrade, currentLiveTrade], strategies: [strategy] })
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

    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/dashboard?kind=live&range=this-week',
      '仪表盘必须把 kind=paper 纠偏为 live',
    )
    const kindButtons = [...document.querySelectorAll<HTMLButtonElement>('.db-range-control button')]
      .map((button) => button.textContent?.trim())
    assert(!kindButtons.includes('模拟盘'), '仪表盘不得再提供模拟盘切换')
    assert(!kindButtons.includes('实盘 + 模拟盘'), '仪表盘不得再提供实盘+模拟盘切换')
    assert(!kindButtons.includes('实盘'), '仪表盘不应再显示单独的实盘分段（固定仅实盘）')
    const selectedRange = [...document.querySelectorAll<HTMLButtonElement>('.db-range-control button')]
      .find((button) => button.textContent?.trim() === '本周')
    assert(selectedRange?.getAttribute('aria-pressed') === 'true', '仪表盘必须从 URL 恢复时间范围')
    await waitFor(() => Boolean(document.querySelector('a.db-strat')), '策略分析链接未出现')
    assert(document.body.textContent?.includes('+$250'), '仪表盘纠偏后只统计实盘')
    assert(!document.body.textContent?.includes('实盘 + 模拟盘'), '界面不得再出现合并范围文案')
    const currentRangeHeading = document.querySelector<HTMLElement>('[data-dashboard-current-range]')
    const weekContext = document.querySelector<HTMLElement>('[aria-label="本周交易分析"]')
    assert(currentRangeHeading && weekContext, '仪表盘必须标明当前分析范围与本周上下文')
    assert(
      Boolean(currentRangeHeading.compareDocumentPosition(weekContext) & Node.DOCUMENT_POSITION_FOLLOWING),
      '当前分析范围必须先于本周交易分析',
    )

    const link = document.querySelector<HTMLAnchorElement>('a.db-strat')
    assert(
      link?.getAttribute('href') === '/strategy/paper-strategy?kind=live&range=this-week',
      '策略下钻链接必须使用实盘范围',
    )
    link.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/strategy/paper-strategy?kind=live&range=this-week',
      '进入策略页后分析范围丢失',
    )

    root.unmount()
    const openLiveTrade: Trade = {
      ...openPaperTrade,
      id: 'live-open',
      ref: 'TRD-LIVE-OPEN',
      tradeKind: 'live',
    }
    useStore.setState({ trades: [openLiveTrade] })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=all&range=this-week']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/active" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/dashboard?kind=live&range=this-week',
      '仪表盘必须把 kind=all 纠偏为 live',
    )
    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '查看进行中交易'),
      '有实盘持仓但无平仓记录时，应引导查看进行中交易',
    )
    const activeButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '查看进行中交易')
    activeButton?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/active',
      '实盘空状态应回到进行中交易工作区',
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
    assert(document.body.textContent?.includes('历史实盘'), 'Dashboard 必须提供历史实盘入口')
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
          <Route path="/live-history" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/live-history?kind=live&symbol=BTCUSDT',
      '历史范围深链不得静默展示当前 Dashboard，必须安全转到历史实盘入口',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=all&range=all']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
          <Route path="/live-history" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all',
      '仪表盘必须把 kind=all 纠偏为 live',
    )
    await waitFor(() => document.body.textContent?.includes('+$100') ?? false, '纠偏后只统计当前实盘')
    assert(!document.body.textContent?.includes('+$150'), '仪表盘不得再把模拟盘并入主统计')
    assert(!document.body.textContent?.includes('+$1,050'), '不得把历史归档实盘重新混入统计')
    const anchor = createBusinessDateAnchor(new Date(), useStore.getState().display.tradingDayStartHour)
    const dashboardSelection = buildPerformanceSelection(useStore.getState().trades, {
      scope: { kind: 'live', range: 'all' },
      liveScope: resolveLiveArchiveScope(cycles, null),
      anchor,
      legacyCashCurrencyAssumption: { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
    })
    const kpi = document.querySelector<HTMLAnchorElement>('[data-kpi-drilldown]')
    assert(kpi, 'Dashboard KPI 必须提供统一选择器范围的下钻链接')
    kpi.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent?.startsWith('/list?') ?? false,
      'KPI 下钻必须进入携带分析范围的交易 URL',
    )
    const dashboardIds = new Set(dashboardSelection.eligibleMetricIds)
    await waitFor(
      () => document.querySelectorAll('[data-trade-id]').length === dashboardIds.size,
      '真实 /list 未显示 Dashboard 选择器的完整集合',
    )
    const drilldownIds = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
        .map((row) => row.dataset.tradeId!)
        .filter(Boolean),
    )
    const difference = [
      ...dashboardSelection.eligibleMetricIds.filter((id) => !drilldownIds.has(id)),
      ...[...drilldownIds].filter((id) => !dashboardIds.has(id)),
    ]
    assert(difference.length === 0, `KPI URL 与 Dashboard 选择器 ID 差集必须为 0，实际 ${difference.join(',')}`)

    const assertRealListMatchesSelection = async (
      entry: string,
      scope: { kind: 'live' | 'paper' | 'all', range: 'all' | 'this-week' | 'ytd' },
      archiveKey: string | null,
      label: string,
    ) => {
      const expected = buildPerformanceSelection(useStore.getState().trades, {
        scope,
        liveScope: resolveLiveArchiveScope(cycles, archiveKey),
        anchor,
        legacyCashCurrencyAssumption: { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
      })
      root.unmount()
      root = createRoot(rootElement)
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
            <Route path="/live-history" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      )
      await waitFor(
        () => document.querySelectorAll('[data-trade-id]').length === expected.eligibleMetricIds.length,
        `${label} 的真实列表数量未与 Dashboard 选择器一致`,
      )
      const actualIds = new Set(
        [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
          .map((row) => row.dataset.tradeId!)
          .filter(Boolean),
      )
      const expectedIds = new Set(expected.eligibleMetricIds)
      const delta = [
        ...expected.eligibleMetricIds.filter((id) => !actualIds.has(id)),
        ...[...actualIds].filter((id) => !expectedIds.has(id)),
      ]
      assert(delta.length === 0, `${label} 的 Dashboard/List 双向差集必须为 0，实际 ${delta.join(',')}`)
    }

    await assertRealListMatchesSelection('/list?kind=live&range=all', { kind: 'live', range: 'all' }, null, 'live/all')
    await assertRealListMatchesSelection('/list?kind=paper&range=all', { kind: 'paper', range: 'all' }, null, 'paper/all')
    await assertRealListMatchesSelection('/list?kind=all&range=all', { kind: 'all', range: 'all' }, null, 'all/all')
    await assertRealListMatchesSelection('/list?kind=all&range=this-week', { kind: 'all', range: 'this-week' }, null, 'all/this-week')
    await assertRealListMatchesSelection('/list?kind=live&range=all&statsCycle=archive-cycle', { kind: 'live', range: 'all' }, 'archive-cycle', '历史 archive/all')
    await assertRealListMatchesSelection('/list?kind=live&range=ytd&statsCycle=archive-cycle', { kind: 'live', range: 'ytd' }, 'archive-cycle', '历史 archive/ytd')

    const ytdDay = getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour)
    const ytdTrade: Trade = {
      ...currentLive,
      id: 'calendar-and-performance-ytd',
      ref: 'TRD-YTD',
      openedAt: ytdDay,
      closedAt: ytdDay,
      closedTradingDayKey: ytdDay,
    }
    useStore.setState({ trades: [ytdTrade], livePerformanceCycles: [] })
    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=ytd']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('[data-kpi-drilldown]')), '本年 Dashboard 必须展示 KPI 下钻')
    const ytdDrilldown = document.querySelector<HTMLAnchorElement>('[data-kpi-drilldown]')
    assert(
      ytdDrilldown?.getAttribute('href') === '/list?kind=live&range=ytd',
      'Dashboard 本年下钻必须保留 kind/range，当前实盘不伪造 statsCycle',
    )
    ytdDrilldown.click()
    await waitFor(
      () => document.querySelectorAll('[data-trade-id]').length === 1,
      'Dashboard 本年下钻必须通过可靠平仓日选择器进入真实列表',
    )
    const dashboardYtdIds = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
      .map((row) => row.dataset.tradeId)
      .filter(Boolean)
      .join(',')

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/board?kind=live&range=ytd']}>
        <Routes>
          <Route path="/board" element={<><TradeLogPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.body.textContent?.includes('仪表盘绩效下钻 · 按可靠平仓日')
        && document.querySelectorAll('[data-trade-id]').length === 1,
      'Dashboard 本年下钻到 BoardView 必须保留可靠平仓日口径与真实交易 DOM',
    )
    assert(
      document.querySelector('[data-testid="location"]')?.textContent === '/board?kind=live&range=ytd',
      'Dashboard 本年 Board 下钻不得丢失分析 URL',
    )

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/period/ytd']}>
        <Routes>
          <Route path="/period/:slug" element={<><PeriodPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('h1')?.textContent === '本年'
        && document.querySelectorAll('[data-trade-id]').length === 1,
      '/period/ytd 必须保留本年标题并渲染真实列表 DOM',
    )
    assert(
      document.querySelector('[data-testid="location"]')?.textContent === '/period/ytd',
      '/period/ytd 不得静默跳转到 today',
    )
    assert(document.body.textContent?.includes('按开仓日'), '/period/ytd 副标题必须说明按开仓日')
    const calendarYtdIds = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
      .map((row) => row.dataset.tradeId)
      .filter(Boolean)
      .join(',')
    assert(calendarYtdIds === dashboardYtdIds, '本年路由与 Dashboard 本年下钻在同一交易样本上必须展示同一 ID')

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/period/bad/board?symbol=BTCUSDT']}>
        <Routes>
          <Route path="/period/:slug/board" element={<><PeriodPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector('[data-invalid-period]')),
      '非法 period slug 必须显示可解释的恢复页',
    )
    assert(
      document.body.textContent?.includes('/period/bad/board?symbol=BTCUSDT'),
      '恢复页必须完整解释用户原始 pathname 与 query',
    )
    assert(
      document.querySelector('[data-testid="location"]')?.textContent === '/period/bad/board?symbol=BTCUSDT',
      '非法 slug 不得静默跳转 today 或丢失 board/query',
    )

    const dayBefore = (days: number) => {
      const date = new Date(`${currentDay}T12:00:00`)
      date.setDate(date.getDate() - days)
      return formatYmd(date)
    }
    const multiCycles: LivePerformanceCycle[] = [
      { id: 'first-cycle', name: '第一段', startTradingDayKey: dayBefore(45), createdAt: `${dayBefore(45)}T00:00:00.000Z` },
      { id: 'middle-cycle', name: '中间段', startTradingDayKey: dayBefore(20), createdAt: `${dayBefore(20)}T00:00:00.000Z` },
      { id: 'multi-current', name: '当前段', startTradingDayKey: currentDay, createdAt: `${currentDay}T00:00:00.000Z` },
    ]
    const preCycleTrade: Trade = { ...archivedLive, id: 'pre-cycle-trade', ref: 'TRD-PRE', openedAt: dayBefore(60), closedAt: dayBefore(60), closedTradingDayKey: dayBefore(60) }
    const firstArchiveTrade: Trade = { ...archivedLive, id: 'first-archive-trade', ref: 'TRD-FIRST', openedAt: dayBefore(30), closedAt: dayBefore(30), closedTradingDayKey: dayBefore(30) }
    const middleArchiveTrade: Trade = { ...archivedLive, id: 'middle-archive-trade', ref: 'TRD-MIDDLE', openedAt: dayBefore(10), closedAt: dayBefore(10), closedTradingDayKey: dayBefore(10) }
    const multiCurrentTrade: Trade = { ...currentLive, id: 'multi-current-trade', ref: 'TRD-MULTI-CURRENT', openedAt: currentDay, closedAt: currentDay, closedTradingDayKey: currentDay }
    useStore.setState({ trades: [preCycleTrade, firstArchiveTrade, middleArchiveTrade, multiCurrentTrade], livePerformanceCycles: multiCycles })
    const allArchivesSelection = buildPerformanceSelection(useStore.getState().trades, {
      scope: { kind: 'live', range: 'all' },
      liveScope: resolveLiveArchiveScope(multiCycles, 'all'),
      anchor,
      legacyCashCurrencyAssumption: { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
    })
    assert(allArchivesSelection.drilldownTarget.includes('statsCycle=all'), 'all-archives 下钻必须使用 reserved all')
    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={[`/list${allArchivesSelection.drilldownTarget}`]}>
        <Routes>
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
          <Route path="/live-history" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelectorAll('[data-trade-id]').length === allArchivesSelection.eligibleMetricIds.length,
      'all-archives 真实列表必须包含全部历史范围',
    )
    const allArchiveActualIds = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
        .map((row) => row.dataset.tradeId!)
        .filter(Boolean),
    )
    const allArchiveExpectedIds = new Set(allArchivesSelection.eligibleMetricIds)
    const allArchiveDelta = [
      ...allArchivesSelection.eligibleMetricIds.filter((id) => !allArchiveActualIds.has(id)),
      ...[...allArchiveActualIds].filter((id) => !allArchiveExpectedIds.has(id)),
    ]
    assert(allArchiveDelta.length === 0, `all-archives Dashboard/List 双向差集必须为 0，实际 ${allArchiveDelta.join(',')}`)
    assert(allArchiveActualIds.has('pre-cycle-trade'), 'all-archives 必须包含规则前记录')
    assert(allArchiveActualIds.has('middle-archive-trade'), 'all-archives 必须包含中间 archive 记录')
    assert(!allArchiveActualIds.has('multi-current-trade'), 'all-archives 必须排除 current 记录')

    useStore.setState({ trades: [archivedLive, currentLive, historicalPaper], livePerformanceCycles: cycles })

    root.unmount()
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/list?kind=live&range=all&statsCycle=removed-archive']}>
        <Routes>
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
          <Route path="/live-history" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent?.includes(
        '/live-history?kind=live&range=all&archiveReason=missing&requestedKey=removed-archive',
      ) ?? false,
      '失效 archive 下钻必须经统一路由进入带解释原因的历史归档首页',
    )

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

    root.unmount()
    const usdLive: Trade = {
      ...currentLiveTrade,
      id: 'currency-usd-live',
      ref: 'TRD-USD',
      pnl: 100,
      cashCurrency: 'USD',
      closedAt: currentDay,
      closedTradingDayKey: currentDay,
    }
    const cnyLive: Trade = {
      ...usdLive,
      id: 'currency-cny-live',
      ref: 'TRD-CNY',
      pnl: 900,
      cashCurrency: 'CNY',
    }
    const unknownLive: Trade = {
      ...usdLive,
      id: 'currency-unknown-live',
      ref: 'TRD-UNKNOWN',
      pnl: 50,
      cashCurrency: null,
    }
    useStore.setState({
      trades: [usdLive, cnyLive, unknownLive],
      livePerformanceCycles: [],
      profile: { ...useStore.getState().profile, legacyCashCurrencyAssumption: null },
    })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=live&range=all']}>
        <Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-currency-merge-status="usd-with-exclusions"]') !== null,
      '混合币种 Dashboard 必须显示 currencyMergeStatus',
    )
    const currencyHealth = document.querySelector('[data-currency-merge-status]')?.textContent ?? ''
    assert(currencyHealth.includes('USD 覆盖 1/3 笔'), 'Dashboard 必须显示 USD 覆盖笔数')
    assert(currencyHealth.includes('CNY 1 笔') && currencyHealth.includes('币种未知 1 笔'), 'Dashboard 必须列出排除币种与 unknown 数量')
    assert(document.body.textContent?.includes('+$100'), '仪表盘净盈亏只合并 USD 实盘')
    assert(!document.body.textContent?.includes('实盘 +$100 · 模拟'), '仪表盘不得再展示实盘/模拟分列盈亏')
    assert(!document.body.textContent?.includes('+$1,050'), 'Dashboard 不得生成跨币种单一总数')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
      livePerformanceCycles: previous.livePerformanceCycles,
      profile: previous.profile,
    })
  }
}

window.__dashboardAnalysisScopeTest = run()
