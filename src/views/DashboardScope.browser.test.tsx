import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { DetailView } from '@/views/DetailView'
import { TradeLogPage } from '@/App'

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
  const historicalWithFutureDate = liveTrade('historical', 'stage-old', 900, '2099-01-01')
  const currentWithOldDate = liveTrade('current', 'stage-current', 100, '2000-01-01')

  try {
    useStore.setState({
      trades: [historicalWithFutureDate, currentWithOldDate],
      strategies: [strategy],
      liveStages: stages,
      currentLiveStageId: 'stage-current',
      liveStatsStartTradingDayKey: '2099-01-01',
      livePerformanceCycles: [{ id: 'legacy-current', name: '旧周期', startTradingDayKey: '2099-01-01', createdAt: '2099-01-01T00:00:00.000Z' }],
    })
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=paper&range=all&liveStage=stage-old&symbol=BTCUSDT']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/list" element={<><TradeLogPage /><LocationProbe /></>} />
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?kind=live&range=all&liveStage=current&symbol=BTCUSDT',
      'Dashboard 必须规范为显式 current stage，并保留无关查询',
    )
    await waitFor(() => document.body.textContent?.includes('+$100') ?? false, 'Dashboard 必须统计当前 stage 的已编辑事实')
    assert(!document.body.textContent?.includes('+$900'), '历史 stage 即使日期较新也不得进入当前 Dashboard')
    assert(!document.body.textContent?.includes('+$1,000'), 'legacy 周期不得重新合并跨 stage 数据')

    const currentLink = document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')
    assert(currentLink?.getAttribute('href') === '/list?kind=live&range=all&liveStage=current', '查看交易必须携带显式 current stage')
    const strategyLink = document.querySelector<HTMLAnchorElement>('a.db-strat')
    assert(strategyLink?.getAttribute('href') === '/strategy/breakout?kind=live&range=all&liveStage=current', '策略下钻必须携带 current stage')
    const kpi = document.querySelector<HTMLAnchorElement>('[data-kpi-drilldown]')
    assert(kpi?.getAttribute('href') === '/list?kind=live&range=all&liveStage=current', 'KPI 下钻必须携带同一 current stage')

    kpi.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/list?kind=live&range=all&liveStage=current', 'KPI 下钻没有保留 stage URL')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, 'KPI 下钻必须与 Dashboard 当前 stage 集合一致')
    assert(document.querySelector('[data-trade-id="current"]'), '下钻列表必须显示当前 stage 记录')
    assert(!document.querySelector('[data-trade-id="historical"]'), '下钻列表不得显示历史 stage 记录')

    document.querySelector<HTMLButtonElement>('[aria-label="打开 BTCUSDT TRD-current"]')?.click()
    await waitFor(() => Boolean(document.querySelector('[aria-label="返回列表"]')), '当前 stage 行必须继续使用原详情路径')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回列表"]')?.click()
    await waitFor(() => document.querySelector('[data-testid="location"]')?.textContent === '/list?kind=live&range=all&liveStage=current', '详情返回必须恢复 stage 与过滤查询')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
      livePerformanceCycles: previous.livePerformanceCycles,
    })
  }
}

window.__dashboardAnalysisScopeTest = run()
