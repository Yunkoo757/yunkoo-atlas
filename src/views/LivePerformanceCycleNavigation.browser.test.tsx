import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { getTradingDayKey } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { BoardView } from '@/views/BoardView'
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
function trade(id: string, day: string, liveStageId: string | null): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium',
    strategyId: strategy.id, tradeKind: 'live', liveStageId, tags: [], mistakeTags: [],
    reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1,
    pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day,
    closedTradingDayKey: day, note: '',
  }
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const day = getTradingDayKey(new Date(), previous.display.tradingDayStartHour)
  const root = createRoot(element)
  try {
    useStore.setState({
      trades: [
        trade('old', day, 'stage-archived'),
        trade('current', day, previous.currentLiveStageId),
        trade('pending', day, null),
      ],
      strategies: [strategy],
      liveStages: [{
        id: 'stage-archived', sequence: 1, name: '实盘阶段 1', status: 'archived',
        startsOn: '2026-01-01', endsOn: '2026-01-31', createdAt: '2026-01-01T00:00:00.000Z',
        archivedAt: '2026-02-01T00:00:00.000Z',
      }, ...previous.liveStages],
    })
    const factsBeforeNavigation = JSON.stringify(useStore.getState().trades)
    const router = createMemoryRouter([
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/list', element: <ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} /> },
      { path: '/board', element: <BoardView title="交易日志" view="board" onView={() => undefined} onOpen={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} /> },
      { path: '/settings/data-health', element: <div>数据健康</div> },
    ], { initialEntries: ['/dashboard'] })
    root.render(<RouterProvider router={router} />)

    await waitFor(() => document.body.textContent?.includes('当前实盘统计') ?? false, 'Dashboard 必须默认显示当前实盘统计')
    assert(document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')?.getAttribute('href') === '/list?kind=live&range=all&liveStage=current', '当前日志入口必须携带规范 current stage')

    await router.navigate('/list?symbol=BTCUSDT')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '普通日志必须只显示当前 stage')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'current', '普通日志不得混入归档或 pending')
    const pendingLink = document.querySelector<HTMLAnchorElement>('[data-pending-log-link]')
    assert(pendingLink?.getAttribute('href') === '/settings/data-health', 'pending 必须进入数据健康而非日期范围日志')
    assert(pendingLink?.textContent?.includes('待归属 1'), 'pending 数量必须只统计显式 null 归属')

    await router.navigate('/list?statsCycle=old&liveCycle=pre-cycle&liveStage=stage-archived&symbol=BTCUSDT')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '兼容参数不得改变当前日志投影')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'current', '日期周期与历史 stage 参数不得成为普通日志归属真相')

    await router.navigate('/board?liveStage=all-history&symbol=BTCUSDT')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '普通看板必须只显示当前 stage')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'current', 'all-history 参数不得污染普通看板')
    assert(JSON.stringify(useStore.getState().trades) === factsBeforeNavigation, '导航与 URL 规范化不得改写交易事实')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      livePerformanceCycles: previous.livePerformanceCycles,
      display: previous.display,
    })
  }
}

window.__livePerformanceCycleNavigationTest = run()
