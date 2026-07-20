import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { getStorage } from '@/storage/bootstrap'
import {
  hasNoteDraft,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'

declare global {
  interface Window {
    __reviewCompletionFlowTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
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
    .find((button) =>
      button.textContent?.trim() === label ||
      button.getAttribute('aria-label') === label,
    )
}

const strategy: Strategy = {
  id: 'review-strategy',
  name: '复盘策略',
  icon: 'target',
  color: '#5e6ad2',
}

const trade: Trade = {
  id: 'review-template-trade',
  ref: 'TRD-REVIEW',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: strategy.id,
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-07-15',
  closedAt: '2026-07-16',
  note: '',
}

const raceTrade: Trade = {
  ...trade,
  id: 'review-race-trade',
  ref: 'TRD-REVIEW-RACE',
  note: '<p>完整复盘结论</p>',
}

const filledTrade: Trade = {
  ...trade,
  id: 'review-filled-trade',
  ref: 'TRD-REVIEW-FILLED',
  note: '<p>这笔交易追价，下次等待回踩确认。</p>',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  let root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveAsset = storage.saveAsset.bind(storage)

  try {
    useStore.setState({ trades: [trade], strategies: [strategy] })
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(findButton('完成复盘')), '完成复盘操作未出现')
    findButton('完成复盘')?.click()
    await waitForFrame()
    assert(
      useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '空白笔记不能直接完成复盘',
    )
    assert(!findButton('使用策略模板'), '详情页不应继续提供策略模板入口')
    assert(!findButton('使用复盘模板'), '详情页不应继续提供内置模板入口')

    root.unmount()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [filledTrade] })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW-FILLED']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => findButton('完成复盘')?.disabled === false,
      '已有复盘结论时完成操作仍不可用',
    )
    findButton('完成复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'reviewed',
      '写下复盘结论后仍无法完成复盘',
    )
    assert(!document.querySelector('.dv-review-stage'), '已完成状态不应继续占据正文首屏')
    assert(!document.querySelector('.dv-review-chip'), '已完成状态不应继续显示待复盘 chip')
    assert(
      document.querySelector('.dv-review-complete-meta')?.textContent?.trim() === '已复盘',
      '已完成状态应收敛到顶部应用栏',
    )
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('重新复盘')), '更多菜单缺少重新复盘入口')
    findButton('重新复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '顶部菜单无法重新打开复盘',
    )

    root.unmount()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [raceTrade] })
    const saveStarted = deferred<void>()
    const allowSave = deferred<string>()
    storage.saveAsset = async () => {
      saveStarted.resolve()
      return allowSave.promise
    }
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW-RACE']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => findButton('完成复盘')?.disabled === false,
      '并发场景的复盘内容就绪后，完成操作仍不可用',
    )
    setNoteDraft(
      raceTrade.id,
      '<p>完整复盘结论</p><img src="data:image/png;base64,QQ==">',
    )
    findButton('完成复盘')?.click()
    await saveStarted.promise
    setNoteDraft(raceTrade.id, '')
    allowSave.resolve('review-race-asset')
    await waitFor(() => !hasNoteDraft(raceTrade.id), '最新空白草稿没有完成落库')
    await waitForFrame()
    assert(
      useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '保存等待期间被清空的笔记不能继续标记为已复盘',
    )
  } finally {
    root.unmount()
    storage.saveAsset = originalSaveAsset
    resetNoteDraftsForTests()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies })
  }
}

window.__reviewCompletionFlowTest = run()
