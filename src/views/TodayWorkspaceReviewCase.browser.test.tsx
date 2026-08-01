import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useToast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { TodayWorkspace } from '@/views/TodayWorkspace'

declare global {
  interface Window {
    __todayWorkspaceReviewCaseTest?: Promise<void>
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

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
}

function CurrentPath() {
  const location = useLocation()
  return <output data-current-path>{location.pathname}</output>
}

function renderToday(root: Root): void {
  root.render(
    <MemoryRouter initialEntries={['/today']}>
      <CurrentPath />
      <Routes>
        <Route path="/today" element={<TodayWorkspace />} />
        <Route path="/trade/:id" element={<div data-detail-placeholder />} />
      </Routes>
    </MemoryRouter>,
  )
}

const source: Trade = {
  id: 'today-review-source',
  ref: 'TRD-TODAY-SOURCE',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 90,
  size: 1,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-08-01',
  closedAt: null,
  note: '<p>来源正文</p>',
}

function existingCase(): Trade {
  return {
    ...source,
    id: 'existing-case',
    ref: 'CAS-1',
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    note: '<p>既有案例</p>',
  }
}

async function openReviewCaseMenu(): Promise<void> {
  const row = document.querySelector<HTMLElement>(`[data-trade-id="${source.id}"]`)
  assert(row, '今日工作台来源行未渲染')
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 120,
  }))
  await waitFor(() => Boolean(findButton('提炼为案例')), '今日工作台提炼菜单未打开')
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const previousToast = useToast.getState()
  let root: Root | null = null

  try {
    useToast.getState().dismiss()
    useStore.setState({ trades: [source] })
    root = createRoot(rootElement)
    renderToday(root)
    await waitFor(
      () => Boolean(document.querySelector(`[data-trade-id="${source.id}"]`)),
      '今日工作台来源行未就绪',
    )
    await openReviewCaseMenu()
    useStore.setState({ trades: [] })
    findButton('提炼为案例')?.click()
    await waitFor(() => useToast.getState().message !== null, '来源删除后提炼没有回执')
    assert(useToast.getState().message === '原交易已不存在', '来源删除后必须返回缺失来源回执')
    assert(!useStore.getState().trades.some((trade) => trade.tradeKind === 'case'), '来源删除后不得创建孤儿案例')
    assert(document.querySelector('[data-current-path]')?.textContent === '/today', '来源删除后不得跳转')

    root.unmount()
    root = null
    useToast.getState().dismiss()
    useStore.setState({ trades: [source] })
    root = createRoot(rootElement)
    renderToday(root)
    await waitFor(
      () => Boolean(document.querySelector(`[data-trade-id="${source.id}"]`)),
      '并发编号来源行未就绪',
    )
    await openReviewCaseMenu()
    useStore.setState({ trades: [source, existingCase()] })
    findButton('提炼为案例')?.click()
    await waitFor(
      () => useStore.getState().trades.filter((trade) => trade.tradeKind === 'case').length === 2,
      '并发编号场景未创建案例',
    )
    const created = useStore.getState().trades.find((trade) => trade.tradeKind === 'case' && trade.id !== 'existing-case')
    assert(created?.ref === 'CAS-2', '提炼动作必须读取最新 state 分配 CAS-2，不能重复 CAS-1')
    assert(document.querySelector('[data-current-path]')?.textContent === '/trade/CAS-2', '必须导航到动作返回的最新案例')
  } finally {
    root?.unmount()
    useToast.getState().dismiss()
    useToast.setState(previousToast)
    useStore.setState(previousStore)
  }
}

window.__todayWorkspaceReviewCaseTest = run()
