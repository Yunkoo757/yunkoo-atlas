import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { DetailView } from '@/views/DetailView'
import {
  hasNoteDraft,
  resetNoteDraftsForTests,
} from '@/storage/noteDrafts'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __detailAmbientEditorChangeTest?: Promise<void>
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

const trade: Trade = {
  id: 'ambient-detail-trade',
  ref: 'TRD-AMBIENT',
  symbol: 'EURUSD',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 1.1,
  exit: 1.2,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-08-12',
  closedAt: '2026-08-13',
  note: '<p>4H 顺势背景。</p><p>15m 等待确认。</p><img src="/src/views/fixtures/browser-test-image.svg?ambient.png"><p>复盘结论。</p>',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  resetNoteDraftsForTests()
  useSaveStatus.getState().reset()

  try {
    useStore.setState({
      trades: [trade],
      display: { ...previous.display, reviewContextPinned: true },
    })
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-AMBIENT']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => Boolean(rootElement.querySelector('section[data-review-context]')),
      '详情页没有完成盘面摘要展示同步',
    )
    await waitForFrame()
    assert(
      useSaveStatus.getState().status === 'idle',
      '只读打开详情时，展示性摘要同步不得标记为用户未保存编辑',
    )
    assert(!hasNoteDraft(trade.id), '展示性摘要同步不得创建笔记草稿')

    const editable = rootElement.querySelector<HTMLElement>('.ProseMirror')
    const editor = (editable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
    assert(editor, '详情编辑器未就绪')
    editor.commands.insertContent('用户补充')

    await waitFor(
      () => useSaveStatus.getState().status === 'dirty',
      '用户真实编辑后必须进入未保存状态',
    )
    assert(hasNoteDraft(trade.id), '用户真实编辑必须创建可恢复的笔记草稿')
  } finally {
    root.unmount()
    resetNoteDraftsForTests()
    useSaveStatus.getState().reset()
    useStore.setState({
      trades: previous.trades,
      display: previous.display,
    })
  }
}

window.__detailAmbientEditorChangeTest = run()
