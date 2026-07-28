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
  pnl: -100, rMultiple: -1, resultSource: 'pnl', openedAt: '2026-07-26', closedAt: '2026-07-26', note: '',
}

const currentLiveTrade: Trade = {
  ...oldLiveTrade,
  id: 'live-current-cycle',
  ref: 'TRD-CURRENT-LIVE',
  openedAt: '2026-07-27',
  closedAt: '2026-07-27',
}

function HistoryProbe() {
  const { visible } = useWorkbenchVisibleTrades({ type: 'all', tradeKind: 'live' })
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('?liveCycle=current')}>当前周期范围</button>
      <button type="button" onClick={() => navigate('?liveCycle=pre-cycle')}>规则前范围</button>
      <button type="button" onClick={() => navigate('?liveCycle=all')}>全部范围</button>
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

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  try {
    useStore.setState((state) => ({
      trades: [oldLiveTrade, currentLiveTrade],
      liveStatsStartTradingDayKey: '2026-07-27',
      display: { ...state.display, hideClosed: false, tradingDayStartHour: 0 },
    }))
    root.render(<MemoryRouter><HistoryProbe /></MemoryRouter>)

    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE,TRD-OLD-LIVE',
      '交易日志缺省范围必须保留全部实盘历史',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '当前周期范围')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE',
      '显式当前周期范围必须只显示周期内交易',
    )
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '规则前范围')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-OLD-LIVE',
      '规则前范围必须只显示旧交易',
    )
    assert(document.body.textContent?.includes('规则前'), '规则前实盘必须显示中性标签')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '全部范围')?.click()
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE,TRD-OLD-LIVE',
      '全部范围必须显示两笔实盘',
    )

    useStore.setState((state) => ({
      liveStatsStartTradingDayKey: null,
      display: { ...state.display, hideClosed: false, tradingDayStartHour: 0 },
    }))
    root.render(
      <MemoryRouter key="without-cycle" initialEntries={['/?liveCycle=pre-cycle']}>
        <NoCycleProbe />
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector('[data-no-cycle-probe]')),
      '未启用周期测试未完成渲染',
    )
    await waitFor(
      () => document.querySelector('[data-visible-refs]')?.getAttribute('data-visible-refs') === 'TRD-CURRENT-LIVE,TRD-OLD-LIVE',
      '未启用周期时规则前 URL 必须保留默认历史',
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
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
      display: previous.display,
    })
  }
}

window.__liveCycleHistoryBrowserTest = run()
