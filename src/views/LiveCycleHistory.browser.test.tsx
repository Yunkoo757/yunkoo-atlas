import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { TradeRow } from '@/components/trades/TradeRow'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { useStore } from '@/store/useStore'
import { BoardView } from '@/views/BoardView'
import { ListView } from '@/views/ListView'
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
  const { visible } = useWorkbenchVisibleTrades({ type: 'all', tradeKind: 'live', historicalLiveScope: 'trades' })
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('?liveStage=all-history')}>全部历史</button>
      <button type="button" onClick={() => navigate('?liveStage=stage-archived')}>历史归档</button>
      <button type="button" onClick={() => navigate('?liveStage=missing')}>非法阶段</button>
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
  const { trades, visible, totalCount, workspaceCount } = useWorkbenchVisibleTrades(filter)
  return (
    <>
      <TradeFilters filter={filter} trades={trades} strategies={[]} />
      <div
        data-no-cycle-probe
        data-visible-refs={visible.map((trade) => trade.ref).join(',')}
        data-total-count={totalCount}
        data-workspace-count={workspaceCount}
      />
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

function CaseFiltersProbe() {
  const location = useLocation()
  const filter = { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' } as const
  return (
    <>
      <TradeFilters filter={filter} trades={[mistakeCase]} strategies={[]} />
      <span data-case-filter-search={location.search} />
    </>
  )
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  try {
    useStore.setState((state) => ({
      trades: [
        { ...oldLiveTrade, liveStageId: 'stage-archived' },
        { ...currentLiveTrade, liveStageId: state.currentLiveStageId },
        { ...pendingLiveTrade, liveStageId: null },
      ],
      liveStages: [{
        id: 'stage-archived', sequence: 1, name: '实盘阶段 1', status: 'archived',
        startsOn: '2026-07-25', endsOn: '2026-07-27', createdAt: '2026-07-25T00:00:00.000Z',
        archivedAt: '2026-07-28T00:00:00.000Z',
      }, ...state.liveStages],
      display: { ...state.display, hideClosed: false, tradingDayStartHour: 0 },
    }))
    root.render(<MemoryRouter initialEntries={['/live-history?liveStage=all-history']}><HistoryProbe /></MemoryRouter>)

    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '全部历史必须只包含已归档阶段',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '全部历史')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '显式 all-history 必须只显示归档阶段',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '历史归档')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '历史归档范围必须只显示归档交易',
    )
    assert(!document.body.textContent?.includes('规则前'), '新日志范围不得暴露规则前实现术语')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '非法阶段')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '非法历史阶段必须安全回退全部历史且不得混入 current/null',
    )

    useStore.setState((state) => ({
      trades: [
        { ...oldLiveTrade, liveStageId: 'stage-archived' },
        { ...currentLiveTrade, liveStageId: state.currentLiveStageId },
      ],
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
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE',
      '普通日志必须始终只显示当前 stage，兼容周期字段不得改变投影',
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

    useStore.setState({ trades: [{ ...oldLiveTrade, tradeKind: 'live', liveStageId: 'stage-archived' }] })
    await waitFor(
      () => document.querySelector('[data-no-cycle-probe]')?.getAttribute('data-visible-refs') === '',
      '当前 stage 为空时不得显示历史记录',
    )
    assert(document.querySelector('[data-no-cycle-probe]')?.getAttribute('data-total-count') === '1', 'totalCount 必须保留整个非删除资料库')
    assert(document.querySelector('[data-no-cycle-probe]')?.getAttribute('data-workspace-count') === '0', 'workspaceCount 必须只统计当前 stage')

    root.render(
      <MemoryRouter key="current-empty-list">
        <ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} />
      </MemoryRouter>,
    )
    await waitFor(() => document.body.textContent?.includes('当前工作区暂无交易') ?? false, 'List 当前 stage 为空时必须显示工作区空态')
    assert(!document.body.textContent?.includes('还没有任何记录'), 'List 不得把 current-empty/history-present 误判为资料库空')

    root.render(
      <MemoryRouter key="current-empty-board">
        <BoardView title="交易日志" view="board" onView={() => undefined} onOpen={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} />
      </MemoryRouter>,
    )
    await waitFor(() => document.body.textContent?.includes('当前工作区暂无交易') ?? false, 'Board 当前 stage 为空时必须显示工作区空态')
    assert(document.body.textContent?.includes('其他阶段或类型'), 'Board 工作区空态必须准确说明资料库可能有其他 stage')
    assert(!document.body.textContent?.includes('还没有任何记录'), 'Board 不得把 current-empty/history-present 误判为资料库空')

    useStore.setState((state) => ({ trades: [{ ...mistakeCase, liveStageId: state.currentLiveStageId }] }))
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

    root.render(
      <MemoryRouter key="case-filter-contract" initialEntries={['/review-cases?reviewCategory=focus']}>
        <CaseFiltersProbe />
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector<HTMLButtonElement>('[aria-label="移除 旧分类：重点"]')),
      'legacy reviewCategory 必须渲染为可移除的旧分类 chip',
    )
    await waitFor(() => Boolean(document.querySelector<HTMLButtonElement>('.ui-filter-trigger')), '案例筛选入口未渲染')
    document.querySelector<HTMLButtonElement>('.ui-filter-trigger')!.click()
    await waitFor(() => Boolean(document.querySelector('.trade-filter-panel[aria-label="案例筛选"]')), '案例筛选面板未打开')
    assert(document.querySelector('[role="combobox"][aria-label="案例类型"]'), '案例筛选必须真实渲染案例类型')
    assert(document.querySelector('[role="combobox"][aria-label="掌握状态"]'), '案例筛选必须真实渲染掌握状态')
    assert(document.querySelector('[role="combobox"][aria-label="错误标签"]'), '案例筛选必须真实渲染错误标签')
    assert(!document.querySelector('[role="combobox"][aria-label="复盘分类"]'), '普通案例筛选不得渲染 reviewCategory selector')
    document.querySelector<HTMLButtonElement>('[aria-label="移除 旧分类：重点"]')?.click()
    await waitFor(
      () => document.querySelector('[data-case-filter-search]')?.getAttribute('data-case-filter-search') === '',
      '移除 legacy chip 必须真实清除 reviewCategory 查询',
    )
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      display: previous.display,
    })
  }
}

window.__liveCycleHistoryBrowserTest = run()
