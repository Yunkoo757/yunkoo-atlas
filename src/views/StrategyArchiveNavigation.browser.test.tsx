import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { StrategyPage } from '@/App'
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
      () => router.state.location.search.includes('liveStage=current')
        && !router.state.location.search.includes('statsCycle')
        && (document.body.textContent?.includes('TRD-STRATEGY-CURRENT') ?? false),
      '策略实盘深链必须规范到当前 stage 并展示当前阶段交易',
    )
    assert(!document.body.textContent?.includes('TRD-STRATEGY-ARCHIVE'), '策略绩效不得因日期周期参数混入历史 stage')

    await router.navigate('/strategy/archive-strategy?kind=live&range=all&liveStage=stage-archived&symbol=BTCUSDT')
    await waitFor(
      () => router.state.location.search.includes('liveStage=current')
        && router.state.location.search.includes('symbol=BTCUSDT'),
      '策略实盘必须把历史 stage 请求安全规范为 current 且保留筛选',
    )

    await router.navigate('/strategy/archive-strategy?kind=paper&range=all&liveStage=stage-archived&symbol=BTCUSDT')
    await waitFor(
      () => !router.state.location.search.includes('liveStage')
        && router.state.location.search.includes('symbol=BTCUSDT'),
      '模拟策略必须保持原语义并清除实盘 stage 参数',
    )
  } finally {
    root.unmount()
    useStore.setState({ strategies: previous.strategies, trades: previous.trades })
  }
}
window.__strategyArchiveNavigationTest = run()
