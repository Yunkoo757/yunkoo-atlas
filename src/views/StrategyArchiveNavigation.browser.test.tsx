import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { StrategyPage } from '@/App'
import type { LiveStage } from '@/lib/liveStages'
import { useStore } from '@/store/useStore'

declare global { interface Window { __strategyArchiveNavigationTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) { if (check()) return; await new Promise((resolve) => requestAnimationFrame(resolve)) }
  throw new Error(message)
}
function RouteProbe() { const location = useLocation(); return <output data-route>{location.pathname}{location.search}</output> }

const strategy: Strategy = { id: 'archive-strategy', name: '归档策略', icon: 'target', color: '#5e6ad2' }
const archivedStage: LiveStage = {
  id: 'stage-archived',
  sequence: 0,
  name: '历史阶段',
  status: 'archived',
  startsOn: '2026-01-01',
  endsOn: '2026-01-31',
  createdAt: '2026-01-01T00:00:00.000Z',
  archivedAt: '2026-02-01T00:00:00.000Z',
}
function trade(id: string, ref: string, liveStageId: string): Trade {
  return {
    id, ref, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium',
    strategyId: strategy.id, tradeKind: 'live', liveStageId, tags: [], mistakeTags: [],
    reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1,
    pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: '2026-01-15',
    closedAt: '2026-01-15', closedTradingDayKey: '2026-01-15', note: '',
  }
}

async function run(): Promise<void> {
  const element = document.getElementById('root'); assert(element, '缺少测试挂载节点')
  const previous = useStore.getState(); const root = createRoot(element)
  try {
    useStore.setState({
      strategies: [strategy],
      liveStages: [archivedStage, ...previous.liveStages],
      trades: [
        trade('strategy-archive-trade', 'TRD-STRATEGY-ARCHIVE', 'stage-archived'),
        trade('strategy-current-trade', 'TRD-STRATEGY-CURRENT', previous.currentLiveStageId),
      ],
    })
    const router = createMemoryRouter([
      { path: '/strategy/:id', element: <><StrategyPage /><RouteProbe /></> },
    ], { initialEntries: ['/strategy/archive-strategy?kind=live&range=all&statsCycle=archive-cycle'] })
    root.render(<RouterProvider router={router} />)

    await waitFor(
      () => !router.state.location.search.includes('liveStage')
        && !router.state.location.search.includes('statsCycle')
        && (document.body.textContent?.includes('TRD-STRATEGY-CURRENT') ?? false),
      '策略实盘旧深链必须清除过期参数，以默认 URL 展示当前阶段交易',
    )
    assert(!document.body.textContent?.includes('TRD-STRATEGY-ARCHIVE'), '策略绩效不得因日期周期参数混入历史 stage')

    await router.navigate('/strategy/archive-strategy?kind=live&range=all&liveStage=stage-archived&symbol=BTCUSDT')
    await waitFor(
      () => router.state.location.search.includes('liveStage=stage-archived')
        && router.state.location.search.includes('symbol=BTCUSDT')
        && (document.body.textContent?.includes('TRD-STRATEGY-ARCHIVE') ?? false),
      '策略实盘必须保留合法历史阶段及筛选，并展示该阶段交易',
    )
    assert(!document.body.textContent?.includes('TRD-STRATEGY-CURRENT'), '历史策略范围不得混入当前阶段交易')

    await router.navigate('/strategy/archive-strategy?kind=paper&range=all&liveStage=stage-archived&symbol=BTCUSDT')
    await waitFor(
      () => router.state.location.search.includes('liveStage=stage-archived')
        && router.state.location.search.includes('symbol=BTCUSDT'),
      '模拟策略必须保持盘型语义，并保留跨模块共享的阶段范围',
    )
  } finally {
    root.unmount()
    useStore.setState({ strategies: previous.strategies, liveStages: previous.liveStages, trades: previous.trades })
  }
}
window.__strategyArchiveNavigationTest = run()
