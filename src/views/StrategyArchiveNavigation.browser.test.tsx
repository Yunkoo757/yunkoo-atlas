import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { StrategyPage } from '@/App'
import { LiveArchiveView } from '@/views/LiveArchiveView'
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
const cycles: LivePerformanceCycle[] = [
  { id: 'archive-cycle', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'current-cycle', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' },
]
const oldTrade: Trade = { id: 'strategy-archive-trade', ref: 'TRD-STRATEGY-ARCHIVE', symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: strategy.id, tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: '2026-01-15', closedAt: '2026-01-15', closedTradingDayKey: '2026-01-15', note: '' }
const preCycleTrade: Trade = { ...oldTrade, id: 'strategy-pre-cycle-trade', ref: 'TRD-STRATEGY-PRE', openedAt: '2025-12-15', closedAt: '2025-12-15', closedTradingDayKey: '2025-12-15', pnl: 80 }
const currentTrade: Trade = { ...oldTrade, id: 'strategy-current-trade', ref: 'TRD-STRATEGY-CURRENT', openedAt: '2026-02-15', closedAt: '2026-02-15', closedTradingDayKey: '2026-02-15', pnl: 200 }

async function run(): Promise<void> {
  const element = document.getElementById('root'); assert(element, '缺少测试挂载节点')
  const previous = useStore.getState(); const root = createRoot(element)
  try {
    useStore.setState({ strategies: [strategy], trades: [preCycleTrade, oldTrade, currentTrade], livePerformanceCycles: cycles })
    const router = createMemoryRouter([
      { path: '/strategy/:id', element: <><StrategyPage /><RouteProbe /></> },
      { path: '/live-archive', element: <><LiveArchiveView /><RouteProbe /></> },
      { path: '/live-archive/:archiveId', element: <><LiveArchiveView /><RouteProbe /></> },
    ], { initialEntries: ['/strategy/archive-strategy?kind=live&range=all&statsCycle=archive-cycle'] })
    root.render(<RouterProvider router={router} />)
    await waitFor(
      () => router.state.location.pathname === '/live-archive'
        && router.state.location.search.includes('archiveReason=missing')
        && router.state.location.search.includes('requestedKey=archive-cycle')
        && (document.body.textContent?.includes('历史记录') ?? false)
        && (document.body.textContent?.includes('TRD-STRATEGY-ARCHIVE') ?? false),
      '策略历史深链必须合并到统一历史记录并展示对应交易',
    )

    await router.navigate('/strategy/archive-strategy?kind=live&range=all&statsCycle=all')
    await waitFor(() => router.state.location.pathname === '/live-archive' && router.state.location.search === '?kind=live&range=all' && (document.body.textContent?.includes('历史记录') ?? false), '策略 all 深链必须回到归档首页并保留分析范围')
    await router.navigate('/strategy/archive-strategy?kind=live&range=all&statsCycle=missing-archive')
    await waitFor(() => router.state.location.pathname === '/live-archive' && router.state.location.search.includes('archiveReason=missing') && (document.body.textContent?.includes('历史记录') ?? false), '策略无效深链必须回到归档首页并保留失效原因')

    await router.navigate('/strategy/archive-strategy?kind=live&range=all&statsCycle=pre-cycle')
    await waitFor(
      () => router.state.location.pathname === '/live-archive'
        && (document.body.textContent?.includes('TRD-STRATEGY-PRE') ?? false),
      '规则前成员深链必须合并到统一历史并展示对应交易',
    )

    useStore.setState({ trades: [oldTrade, currentTrade] })
    await router.navigate('/strategy/archive-strategy?kind=live&range=all&statsCycle=pre-cycle')
    await waitFor(() => router.state.location.pathname === '/live-archive' && (document.body.textContent?.includes('历史记录') ?? false), '规则前没有成员时必须回到归档首页')
  } finally { root.unmount(); useStore.setState({ strategies: previous.strategies, trades: previous.trades, livePerformanceCycles: previous.livePerformanceCycles }) }
}
window.__strategyArchiveNavigationTest = run()
