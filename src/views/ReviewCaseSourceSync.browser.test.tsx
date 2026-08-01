import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
    __reviewCaseSourceSyncTest?: Promise<void>
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
    .find((button) =>
      button.textContent?.trim() === label ||
      button.getAttribute('aria-label') === label,
    )
}

function CurrentPath() {
  return <output data-current-path>{useLocation().pathname}</output>
}

function renderDetail(root: Root, route: string): void {
  root.render(
    <MemoryRouter initialEntries={[route]}>
      <CurrentPath />
      <Routes>
        <Route path="/trade/:id" element={<DetailView />} />
      </Routes>
    </MemoryRouter>,
  )
}

const source: Trade = {
  id: 'review-case-source',
  ref: 'TRD-SOURCE',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  tradeKind: 'live',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 1,
  resultSource: 'imported',
  openedAt: '2026-07-31',
  closedAt: '2026-07-31',
  note: '',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const storage = getStorage()
  const originalSaveAsset = storage.saveAsset.bind(storage)
  let root: Root | null = null

  resetNoteDraftsForTests()
  try {
    useStore.setState({ trades: [source] })
    root = createRoot(rootElement)
    renderDetail(root, '/trade/TRD-SOURCE')

    await waitFor(() => Boolean(findButton('更多')), '来源详情未就绪')
    setNoteDraft(source.id, '<p>刚补充、尚未 idle 保存的复盘</p>')
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '提炼入口未出现')
    findButton('提炼为案例')?.click()
    await waitFor(
      () => useStore.getState().trades.some((trade) => trade.tradeKind === 'case'),
      '案例未创建',
    )
    const reviewCase = useStore.getState().trades.find((trade) => trade.tradeKind === 'case')!
    assert(
      reviewCase.sourceNoteHtml === '<p>刚补充、尚未 idle 保存的复盘</p>',
      '创建前必须冲洗最新草稿',
    )
    assert(reviewCase.note === '', '案例沉淀必须为空')
    await waitFor(
      () => document.body.textContent?.includes('来源复盘') ?? false,
      '案例页缺少来源复盘',
    )
    await waitFor(
      () =>
        document.querySelector('[aria-label="来源复盘正文"]')?.getAttribute('contenteditable') === 'false' &&
        document.querySelector('[aria-label="案例沉淀正文"]')?.getAttribute('contenteditable') === 'true',
      '案例双正文权限未就绪',
    )
    assert(
      document.querySelector('[aria-label="来源复盘正文"]')?.getAttribute('contenteditable') === 'false',
      '来源正文必须只读',
    )
    assert(
      document.querySelector('[aria-label="案例沉淀正文"]')?.getAttribute('contenteditable') === 'true',
      '案例沉淀必须可编辑',
    )

    useStore.getState().updateNote(reviewCase.id, '<p>案例自己的结论</p>')
    useStore.getState().updateNote(source.id, '<p>创建后的最新来源</p>')
    await waitFor(
      () => document.body.textContent?.includes('创建后的最新来源') ?? false,
      '来源后续更新未进入只读区',
    )
    const syncedCase = useStore.getState().trades.find((trade) => trade.id === reviewCase.id)!
    assert(syncedCase.note === '<p>案例自己的结论</p>', '来源同步覆盖了案例沉淀')
    useStore.getState().purgeTrade(source.id)
    await waitFor(
      () => document.body.textContent?.includes('原交易已不存在') ?? false,
      '来源清理状态未显示',
    )
    assert(
      document.body.textContent?.includes('创建后的最新来源'),
      '来源清理后最后快照必须可读',
    )

    root.unmount()
    root = null
    resetNoteDraftsForTests()
    const failedSource = { ...source, id: 'source-failed', ref: 'TRD-FAILED', note: '' }
    useStore.setState({ trades: [failedSource] })
    storage.saveAsset = async () => { throw new Error('fixture asset failure') }
    setNoteDraft(
      failedSource.id,
      '<p>保存失败</p><img src="data:image/png;base64,QQ==">',
    )
    root = createRoot(rootElement)
    renderDetail(root, '/trade/TRD-FAILED')
    await waitFor(() => Boolean(findButton('更多')), '失败来源详情未就绪')
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '失败来源提炼入口未出现')
    findButton('提炼为案例')?.click()
    await waitForFrame()
    await waitForFrame()
    assert(
      !useStore.getState().trades.some((trade) => trade.tradeKind === 'case'),
      '草稿失败时不得创建案例',
    )
    assert(hasNoteDraft(failedSource.id), '草稿失败后必须保留草稿')
    assert(document.body.textContent?.includes('TRD-FAILED'), '草稿失败后必须停留来源详情')
    assert(
      document.querySelector('[data-current-path]')?.textContent === '/trade/TRD-FAILED',
      '草稿失败后不得导航',
    )

    root.unmount()
    root = null
    resetNoteDraftsForTests()
    const legacyCase: Trade = {
      ...source,
      id: 'legacy-case',
      ref: 'CAS-LEGACY',
      tradeKind: 'case',
      sourceTradeId: 'purged-source',
      note: '<p>历史案例原正文</p>',
    }
    useStore.setState({ trades: [legacyCase] })
    root = createRoot(rootElement)
    renderDetail(root, '/trade/CAS-LEGACY')
    await waitFor(
      () => document.querySelector('[aria-label="案例沉淀正文"]')?.textContent?.includes('历史案例原正文') ?? false,
      '历史案例正文未保留在案例沉淀',
    )
    assert(!document.querySelector('[aria-label="来源复盘正文"]'), '无快照的历史案例不得渲染来源正文')
  } finally {
    root?.unmount()
    storage.saveAsset = originalSaveAsset
    resetNoteDraftsForTests()
    useStore.setState(previousStore)
  }
}

window.__reviewCaseSourceSyncTest = run()
