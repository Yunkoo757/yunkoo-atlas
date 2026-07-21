import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { formatYmd } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'

declare global {
  interface Window {
    __dashboardAnalysisScopeTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

const strategy: Strategy = {
  id: 'paper-strategy',
  name: '模拟策略',
  icon: 'target',
  color: '#5e6ad2',
}

const paperTrade: Trade = {
  id: 'paper-win',
  ref: 'TRD-PAPER',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: strategy.id,
  tradeKind: 'paper',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 250,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: formatYmd(new Date()),
  closedAt: formatYmd(new Date()),
  note: '',
}

const openPaperTrade: Trade = {
  ...paperTrade,
  id: 'paper-open',
  ref: 'TRD-PAPER-OPEN',
  status: 'open',
  exit: null,
  pnl: null,
  rMultiple: null,
  resultSource: undefined,
  closedAt: null,
  reviewStatus: 'unreviewed',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  let root = createRoot(rootElement)

  try {
    useStore.setState({ trades: [paperTrade], strategies: [strategy] })
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=paper&range=this-week']}>
        <Routes>
          <Route
            path="/dashboard"
            element={<><Dashboard /><LocationProbe /></>}
          />
          <Route path="/strategy/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('a.db-strat')), '策略分析链接未出现')
    const selectedKind = [...document.querySelectorAll<HTMLButtonElement>('.db-seg')]
      .find((button) => button.textContent?.trim() === '模拟')
    const selectedRange = [...document.querySelectorAll<HTMLButtonElement>('.db-seg')]
      .find((button) => button.textContent?.trim() === '本周')
    assert(selectedKind?.getAttribute('aria-pressed') === 'true', '仪表盘必须从 URL 恢复交易类型')
    assert(selectedRange?.getAttribute('aria-pressed') === 'true', '仪表盘必须从 URL 恢复时间范围')
    assert(document.body.textContent?.includes('+$250'), '仪表盘必须使用 URL 范围内的模拟交易')

    const link = document.querySelector<HTMLAnchorElement>('a.db-strat')
    assert(
      link?.getAttribute('href') === '/strategy/paper-strategy?kind=paper&range=this-week',
      '策略下钻链接必须保留仪表盘范围',
    )
    link.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/strategy/paper-strategy?kind=paper&range=this-week',
      '进入策略页后分析范围丢失',
    )

    root.unmount()
    useStore.setState({ trades: [openPaperTrade] })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/dashboard?kind=paper&range=this-week']}>
        <Routes>
          <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/sim" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '查看进行中交易'),
      '有模拟持仓但无平仓记录时，应引导查看进行中交易',
    )
    const activeButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '查看进行中交易')
    activeButton?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/sim',
      '模拟范围的空状态应回到模拟交易工作区',
    )
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies })
  }
}

window.__dashboardAnalysisScopeTest = run()
