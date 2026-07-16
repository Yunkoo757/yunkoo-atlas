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
    .find((button) => button.textContent?.trim() === label)
}

const strategy: Strategy = {
  id: 'review-strategy',
  name: '复盘策略',
  icon: 'target',
  color: '#5e6ad2',
  reviewTemplateHtml: '<h2>策略复盘</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false">按计划执行</li></ul>',
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

    await waitFor(() => Boolean(findButton('使用策略模板')), '空白复盘应提供策略模板入口')
    const applyTemplate = findButton('使用策略模板')
    assert(applyTemplate, '空白复盘应提供策略模板入口')
    applyTemplate.click()
    await waitFor(
      () => Boolean(document.querySelector('.ProseMirror')?.textContent?.includes('按计划执行')),
      '策略模板没有进入复盘编辑器',
    )

    findButton('完成复盘')?.click()
    await waitForFrame()
    assert(
      useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '原样模板不能直接完成复盘',
    )

    const checklist = document.querySelector<HTMLInputElement>('.ProseMirror input[type="checkbox"]')
    assert(checklist, '策略模板检查项没有渲染')
    checklist.click()
    await waitFor(
      () => document.querySelector('.ProseMirror li')?.getAttribute('data-checked') === 'true',
      '复盘检查项没有保存为已完成',
    )
    findButton('完成复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'reviewed',
      '填写复盘产出后仍无法完成复盘',
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
