import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
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
    const factsBeforeNavigation = JSON.stringify(useStore.getState().trades)
    const router = createMemoryRouter([
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/list', element: <ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} /> },
      { path: '/board', element: <BoardView title="交易日志" view="board" onView={() => undefined} onOpen={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} /> },
      { path: '/live-archive', element: <div>历史归档入口</div> },
      { path: '/live-archive/:archiveId', element: <div>归档详情入口</div> },
    ], { initialEntries: ['/dashboard'] })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => document.body.textContent?.includes('当前实盘统计') ?? false, 'Dashboard 必须默认显示当前实盘统计')
    assert(!document.querySelector('button[role="combobox"]'), 'Dashboard 不得恢复周期下拉')
    assert(document.querySelector<HTMLAnchorElement>('[data-current-live-trade-link]')?.getAttribute('href') === '/list?kind=live&range=all', '当前日志入口必须使用隐式当前范围')
    await router.navigate('/list')
    await waitFor(() => Boolean(document.querySelector('[data-pending-log-link]')), '普通交易日志必须提供待整理入口')
    const pendingLogLink = document.querySelector<HTMLAnchorElement>('[data-pending-log-link]')
    assert(pendingLogLink?.getAttribute('href') === '/list?statsCycle=pending', '待整理入口必须进入共享 pending 日志')
    assert(pendingLogLink?.textContent?.includes('待整理 1'), '待整理入口必须显示共享待整理数量')
    await router.navigate('/list?statsCycle=pending')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '待整理日志必须只显示缺少平仓日的实盘记录')
    await waitFor(() => !document.querySelector('[data-pending-log-link]'), '待整理日志自身不得重复显示待整理入口')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'missing', '待整理日志不得混入当前或历史交易')

    await router.navigate('/board?statsCycle=all&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive', '看板 all 范围必须进入归档首页目标')
    await router.navigate('/board?statsCycle=pre-cycle&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive/pre-cycle', '看板规则前范围必须进入归档详情目标')
    await router.navigate('/board?statsCycle=missing-archive&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive', '看板失效范围必须进入归档首页目标')
    assert(router.state.location.search.includes('archiveReason=missing'), '看板失效范围必须保留统一原因')
    assert(router.state.location.search.includes('requestedKey=missing-archive'), '看板失效范围必须保留请求键')
    assert(JSON.stringify(useStore.getState().trades) === factsBeforeNavigation, 'Dashboard 与日志切换不得改写交易事实')

    let replaceCount = 0
    const unsubscribe = router.subscribe((state) => { if (state.historyAction === 'REPLACE') replaceCount += 1 })
    await router.navigate('/list?statsCycle=pending&liveCycle=pre-cycle&symbol=BTCUSDT')
    await waitFor(() => !router.state.location.search.includes('liveCycle'), '冲突 URL 必须清除风险范围参数')
    unsubscribe()
    assert(replaceCount === 1, `冲突 URL 必须且只能 replace 一次，实际 ${replaceCount} 次`)
    assert(router.state.location.search.includes('symbol=BTCUSDT'), 'URL 规范化不得丢失无关品种筛选')
    assert(JSON.stringify(useStore.getState().trades) === factsBeforeNavigation, 'URL 规范化不得改写交易事实')

    await router.navigate('/list?statsCycle=old&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive/old', '有效历史日志不得继续停在旧日志列表')
    const listArchiveSearch = router.state.location.search
    assert(listArchiveSearch === '?symbol=BTCUSDT', '历史归档详情必须保留无关筛选')

    await router.navigate('/dashboard?kind=live&range=all&statsCycle=old&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive/old', 'Dashboard 历史链接必须进入对应归档详情')
    const dashboardArchiveSearch = router.state.location.search
    assert(dashboardArchiveSearch === '?kind=live&range=all&symbol=BTCUSDT', 'Dashboard 归档导航不得丢失分析范围')

    for (const requested of ['all', 'pre-cycle', 'missing-archive']) {
      await router.navigate(`/list?statsCycle=${requested}&symbol=BTCUSDT`)
      const expectedPath = requested === 'pre-cycle' ? '/live-archive/pre-cycle' : '/live-archive'
      await waitFor(() => router.state.location.pathname === expectedPath, `${requested} 必须安全进入归档目标（当前=${router.state.location.pathname}${router.state.location.search}）`)
      const destinationSearch = router.state.location.search
      assert(destinationSearch.includes('symbol=BTCUSDT'), `${requested} 回退不得丢失安全筛选`)
      if (requested === 'missing-archive') {
        assert(destinationSearch.includes('archiveReason=missing'), '失效范围必须保留统一原因')
        assert(destinationSearch.includes('requestedKey=missing-archive'), '失效范围必须保留请求键')
      }
    }
    await router.navigate('/list?statsCycle=current&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/list' && !router.state.location.search.includes('statsCycle'), '旧 current 链接必须回到动态当前实盘')
    await router.navigate('/list?liveCycle=pre-cycle&symbol=BTCUSDT')
    await waitFor(() => !router.state.location.search.includes('liveCycle'), '单独旧 liveCycle 必须被清理')
    assert(router.state.location.search.includes('symbol=BTCUSDT'), '清理单独旧 liveCycle 不得丢失安全筛选')

    useStore.setState({ livePerformanceCycles: [] })
    await router.navigate('/list?statsCycle=pending')
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1, '无周期时待整理日志仍必须只显示缺少平仓日记录')
    assert(document.querySelector('[data-trade-id]')?.getAttribute('data-trade-id') === 'missing', '无周期待整理不得回退为全部实盘')
    assert(JSON.stringify(useStore.getState().trades) === factsBeforeNavigation, '旧链接回退不得改写交易事实')

    await router.navigate('/list?statsCycle=pre-cycle&symbol=BTCUSDT')
    await waitFor(() => router.state.location.pathname === '/live-archive', '无周期时规则前链接必须回到归档首页')
    const emptyPreCycleSearch = router.state.location.search
    assert(emptyPreCycleSearch.includes('archiveReason=pre-cycle'), '无周期归档首页必须保留规则前原因')
    assert(emptyPreCycleSearch.includes('requestedKey=pre-cycle'), '无周期归档首页必须保留规则前请求键')
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display })
  }
}

window.__livePerformanceCycleNavigationTest = run()
