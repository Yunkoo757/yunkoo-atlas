import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { useStore } from '@/store/useStore'
import { LiveArchiveView } from '@/views/LiveArchiveView'

declare global {
  interface Window {
    __liveArchiveViewTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(check: () => boolean, message: string) {
  for (let index = 0; index < 180; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

function LocationProbe() {
  const location = useLocation()
  return <output data-route>{`${location.pathname}${location.search}`}</output>
}

function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
    ...patch,
  }
}

function WorkbenchRoutes() {
  return (
    <Routes>
      <Route path="/live-history" element={<><LiveArchiveView /><LocationProbe /></>} />
      <Route path="/live-history/board" element={<><LiveArchiveView /><LocationProbe /></>} />
    </Routes>
  )
}

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  const cycles: LivePerformanceCycle[] = [
    { id: 'archive', name: '历史', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'current', name: '当前', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' },
  ]
  const historicalWin = trade('historical-win', '2026-01-15')
  const historicalLoss = trade('historical-loss', '2026-01-16', { status: 'loss', pnl: -100, rMultiple: -1 })
  const current = trade('current', '2026-02-15')

  try {
    useStore.setState((state) => ({
      trades: [
        historicalWin,
        historicalLoss,
        current,
        trade('case-mistake', '2026-01-15', {
          ref: 'CAS-MISTAKE',
          tradeKind: 'case',
          sourceTradeId: historicalWin.id,
          caseType: 'mistake',
          mistakeTags: ['追单'],
        }),
        trade('case-mastered', '2026-01-15', {
          ref: 'CAS-MASTERED',
          tradeKind: 'case',
          sourceTradeId: historicalWin.id,
          masteryState: 'mastered',
          reviewStatus: 'reviewed',
        }),
        trade('case-current', '2026-02-15', {
          ref: 'CAS-CURRENT',
          tradeKind: 'case',
          sourceTradeId: current.id,
        }),
        trade('case-unlinked', '2026-01-15', {
          ref: 'CAS-UNLINKED',
          tradeKind: 'case',
          sourceTradeId: undefined,
        }),
      ],
      strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      livePerformanceCycles: cycles,
      display: {
        ...state.display,
        hideClosed: false,
        groupByDate: true,
        groupByStrategy: false,
        tradingDayStartHour: 0,
      },
    }))

    root.render(
      <MemoryRouter initialEntries={['/live-history']}>
        <WorkbenchRoutes />
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-win"]')), '历史实盘必须显示重置前交易')
    assert(!document.querySelector('[data-trade-id="current"]'), '历史实盘不得显示当前实盘')
    assert(document.querySelector('.quick-view-bar'), '历史实盘必须复用交易工作台快捷视图栏')
    assert(document.querySelector('.ui-filter-shell'), '历史实盘必须复用交易工作台筛选器')
    assert(document.querySelector('[role="group"][aria-label="视图切换"] button[data-value="list"]'), '历史实盘必须复用列表视图控制')
    assert(document.querySelector('[role="group"][aria-label="视图切换"] button[data-value="board"]'), '历史实盘必须复用看板视图控制')
    assert(!document.querySelector('.la-view'), '历史实盘不得继续维护独立页面壳')
    assert(document.body.textContent?.includes('2026年1月'), '历史实盘必须使用标准月份分组')

    ;[...document.querySelectorAll<HTMLButtonElement>('.quick-view-chip')]
      .find((button) => button.textContent?.trim() === '亏损')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-loss"]')), '历史快捷筛选必须留在历史范围')
    assert(!document.querySelector('[data-trade-id="historical-win"]'), '亏损快捷筛选必须使用统一工作台筛选逻辑')
    assert(document.querySelector('[data-route]')?.textContent === '/live-history?status=loss', '历史筛选不得跳回当前交易日志')

    ;[...document.querySelectorAll<HTMLButtonElement>('.quick-view-chip')]
      .find((button) => button.textContent?.trim() === '关联案例')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="case-mistake"]')), '关联案例必须复用同一工作台显示')
    assert(!document.querySelector('[data-trade-id="case-current"]'), '关联案例不得混入当前实盘来源案例')
    assert(!document.querySelector('[data-trade-id="case-unlinked"]'), '关联案例不得混入无来源案例')
    assert(document.querySelector('.ui-filter-trigger span')?.textContent === '筛选', '关联案例视图身份不得误报为额外筛选条件')

    ;[...document.querySelectorAll<HTMLButtonElement>('.quick-view-chip')]
      .find((button) => button.textContent?.trim() === '错题')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="case-mistake"]')), '错题视图必须筛选历史关联案例')
    assert(!document.querySelector('[data-trade-id="case-mastered"]'), '错题视图不得混入已掌握案例')

    document.querySelector<HTMLButtonElement>('[role="group"][aria-label="视图切换"] button[data-value="board"]')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent?.startsWith('/live-history/board') ?? false, '历史实盘必须支持标准看板')
    assert(document.querySelector('.board-scroll'), '历史实盘看板必须复用标准 BoardView')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      livePerformanceCycles: previous.livePerformanceCycles,
      display: previous.display,
    })
  }
}

window.__liveArchiveViewTest = run()
