import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { TradeRow } from '@/components/trades/TradeRow'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/components/trades/TradeList.css'

declare global {
  interface Window {
    __liveCycleHistoryBrowserTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

const oldLiveTrade: Trade = {
  id: 'live-before-cycle', ref: 'TRD-OLD-LIVE', symbol: 'EURUSD', side: 'long', status: 'loss',
  conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live', tags: [], mistakeTags: [],
  reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 1.1, exit: 1.09, size: 1,
  pnl: -100, rMultiple: -1, resultSource: 'pnl', openedAt: '2026-07-26', closedAt: '2026-07-26', closedTradingDayKey: '2026-07-26', note: '',
}

const currentLiveTrade: Trade = {
  ...oldLiveTrade,
  id: 'live-current-cycle',
  ref: 'TRD-CURRENT-LIVE',
  openedAt: '2026-07-28',
  closedAt: '2026-07-28',
  closedTradingDayKey: '2026-07-28',
}

const pendingLiveTrade: Trade = {
  ...oldLiveTrade,
  id: 'live-pending-day',
  ref: 'TRD-PENDING-DAY',
  status: 'loss',
  openedAt: '2026-07-29',
  closedAt: null,
  closedTradingDayKey: undefined,
  pnl: -50,
}

const mistakeCase: Trade = {
  ...oldLiveTrade,
  id: 'case-mistake',
  ref: 'CASE-MISTAKE',
  tradeKind: 'case',
  caseType: 'mistake',
  reviewCategory: 'mistake',
}

function HistoryProbe() {
  const { visible } = useWorkbenchVisibleTrades({ type: 'all', tradeKind: 'live' })
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('?statsCycle=current')}>当前实盘</button>
      <button type="button" onClick={() => navigate('?statsCycle=archive-cycle')}>历史归档</button>
      <button type="button" onClick={() => navigate('?statsCycle=pending')}>待整理</button>
      <div data-visible-refs={visible.map((trade) => trade.ref).join(',')}>
        {visible.map((trade) => (
          <TradeRow
            key={trade.id}
            trade={trade}
            strategies={[]}
            selected={false}
            focused={false}
            starred={false}
            onOpen={() => {}}
            onSelect={() => {}}
            onToggleStar={() => {}}
          />
        ))}
      </div>
    </>
  )
}

function NoCycleProbe() {
  const filter = { type: 'all', tradeKind: 'live' } as const
  const { trades, visible } = useWorkbenchVisibleTrades(filter)
  return (
    <>
      <TradeFilters filter={filter} trades={trades} strategies={[]} />
      <div data-no-cycle-probe data-visible-refs={visible.map((trade) => trade.ref).join(',')} />
    </>
  )
}

function EmptyCaseScopeProbe() {
  const { totalCount, workspaceCount, visible } = useWorkbenchVisibleTrades({
    type: 'all',
    tradeKind: 'case',
    reviewCaseScope: 'focus',
  })
  return (
    <div
      data-empty-case-scope
      data-total-count={totalCount}
      data-workspace-count={workspaceCount}
      data-visible-count={visible.length}
    />
  )
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  try {
    useStore.setState((state) => ({
      trades: [oldLiveTrade, currentLiveTrade, pendingLiveTrade],
      livePerformanceCycles: [
        { id: 'archive-cycle', name: '实盘-2026-07-25', startTradingDayKey: '2026-07-25', createdAt: '2026-07-25T00:00:00.000Z' },
        { id: 'current-cycle', name: '实盘-2026-07-28', startTradingDayKey: '2026-07-28', createdAt: '2026-07-28T00:00:00.000Z' },
      ],
      display: { ...state.display, hideClosed: false, tradingDayStartHour: 0 },
    }))
    root.render(<MemoryRouter><HistoryProbe /></MemoryRouter>)

    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE',
      '交易日志缺省范围必须默认当前实盘',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '当前实盘')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE',
      '显式 current 兼容链接必须只显示当前实盘',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '历史归档')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '历史归档范围必须只显示归档交易',
    )
    assert(!document.body.textContent?.includes('规则前'), '新日志范围不得暴露规则前实现术语')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '待整理')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-PENDING-DAY',
      '待整理范围必须只显示缺少可靠平仓日的记录',
    )

    useStore.setState((state) => ({
      livePerformanceCycles: [],
      trades: [oldLiveTrade, currentLiveTrade],
      display: { ...state.display, hideClosed: false, tradingDayStartHour: 0 },
    }))
    root.render(
      <MemoryRouter key="without-cycle" initialEntries={['/']}>
        <NoCycleProbe />
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector('[data-no-cycle-probe]')),
      '未启用周期测试未完成渲染',
    )
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE,TRD-OLD-LIVE',
      '没有边界时全部历史必须属于当前实盘',
    )
    await waitFor(
      () => Boolean(document.querySelector<HTMLButtonElement>('.ui-filter-trigger')),
      '筛选按钮未出现',
    )
    document.querySelector<HTMLButtonElement>('.ui-filter-trigger')?.click()
    await waitFor(
      () => Boolean(document.querySelector('[role="dialog"][aria-label="交易筛选"]')),
      '筛选面板未打开',
    )
    assert(!document.querySelector('[aria-label="实盘周期"]'), '未启用周期时不得提供规则前筛选项')

    useStore.setState({ trades: [mistakeCase] })
    root.render(
      <MemoryRouter key="empty-case-scope">
        <EmptyCaseScopeProbe />
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector('[data-empty-case-scope]')),
      '空案例分类计数测试未完成渲染',
    )
    const emptyCaseScope = document.querySelector('[data-empty-case-scope]')
    assert(emptyCaseScope?.getAttribute('data-total-count') === '1', '资料库总数不得受当前案例分类影响')
    assert(emptyCaseScope?.getAttribute('data-workspace-count') === '1', '案例工作区总数不得受当前分类影响')
    assert(emptyCaseScope?.getAttribute('data-visible-count') === '0', '重点分类应保持为空以覆盖回归场景')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      livePerformanceCycles: previous.livePerformanceCycles,
      display: previous.display,
    })
  }
}

window.__liveCycleHistoryBrowserTest = run()
