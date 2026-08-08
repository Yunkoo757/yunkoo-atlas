import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { getTradingDayKey } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { ListView } from '@/views/ListView'

declare global { interface Window { __livePerformanceCycleNavigationTest?: Promise<void> } }

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function frame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())) }
async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) { if (condition()) return; await frame() }
  throw new Error(message)
}

const strategy: Strategy = { id: 'strategy', name: '策略', icon: 'target', color: '#5e6ad2' }
function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return { id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: strategy.id, tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day, closedTradingDayKey: day, note: '', ...patch }
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const day = getTradingDayKey(new Date(), previous.display.tradingDayStartHour)
  const earlier = new Date(`${day}T12:00:00`); earlier.setDate(earlier.getDate() - 7)
  const oldDay = earlier.toISOString().slice(0, 10)
  const cycles: LivePerformanceCycle[] = [
    { id: 'old', name: '旧', startTradingDayKey: '2000-01-01', createdAt: '2000-01-01T00:00:00.000Z' },
    { id: 'current', name: '当前', startTradingDayKey: day, createdAt: `${day}T00:00:00.000Z` },
  ]
  const missing = trade('missing', day, { closedAt: 'invalid', closedTradingDayKey: undefined })
  const root = createRoot(element)
  try {
    useStore.setState({ trades: [trade('old', oldDay), trade('current', day), missing], strategies: [strategy], livePerformanceCycles: cycles })
    const router = createMemoryRouter([
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/list', element: <ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} /> },
      { path: '/live-archive', element: <div>历史归档入口</div> },
    ], { initialEntries: ['/dashboard'] })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => document.body.textContent?.includes('当前实盘统计') ?? false, 'Dashboard 必须默认显示当前实盘统计')
    assert(!document.querySelector('button[role="combobox"]'), 'Dashboard 不得恢复周期下拉')
    assert(document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')?.getAttribute('href') === '/list?kind=live&range=all', '当前日志入口必须使用隐式当前范围')
    await router.navigate('/list?statsCycle=pending')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '待整理日志必须只显示缺少平仓日的实盘记录')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'missing', '待整理日志不得混入当前或历史交易')
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display })
  }
}

window.__livePerformanceCycleNavigationTest = run()
