import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { DetailView } from '@/views/DetailView'
import { getStorage } from '@/storage/bootstrap'
import { useToast } from '@/lib/toast'
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

function findEditorImage(label: string, marker: string): HTMLImageElement | undefined {
  const editor = document.querySelector(`[aria-label="${label}"]`)
  return [...(editor?.querySelectorAll<HTMLImageElement>('img') ?? [])]
    .find((image) => image.getAttribute('src')?.includes(marker))
}

function CurrentPath() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div data-test-navigation>
      <output data-current-path>{location.pathname}</output>
      <button type="button" onClick={() => navigate('/trade/TRD-RACE-B')}>
        切换到第二来源
      </button>
    </div>
  )
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

const SOURCE_IMAGE_MARKER = 'review-case-source.png'
const CASE_IMAGE_MARKER = 'review-case-owned.png'
const SOURCE_IMAGE_SRC = `/src/views/fixtures/browser-test-image.svg?${SOURCE_IMAGE_MARKER}`
const CASE_IMAGE_SRC = `/src/views/fixtures/browser-test-image.svg?${CASE_IMAGE_MARKER}`

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const previousToast = useToast.getState()
  const storage = getStorage()
  const originalSaveAsset = storage.saveAsset.bind(storage)
  let root: Root | null = null

  resetNoteDraftsForTests()
  try {
    useShortcutStore.setState({ lightbox: null })
    useStore.setState({ trades: [source] })
    root = createRoot(rootElement)
    renderDetail(root, '/trade/TRD-SOURCE')

    await waitFor(() => Boolean(findButton('更多')), '来源详情未就绪')
    setNoteDraft(source.id, `<p>刚补充、尚未 idle 保存的复盘</p><img src="${SOURCE_IMAGE_SRC}">`)
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '提炼入口未出现')
    findButton('提炼为案例')?.click()
    await waitFor(
      () => useStore.getState().trades.some((trade) => trade.tradeKind === 'case'),
      '案例未创建',
    )
    const reviewCase = useStore.getState().trades.find((trade) => trade.tradeKind === 'case')!
    assert(
      reviewCase.sourceNoteHtml === `<p>刚补充、尚未 idle 保存的复盘</p><img src="${SOURCE_IMAGE_SRC}">`,
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
    await waitFor(() => document.body.textContent?.includes('刚补充、尚未 idle 保存的复盘') ?? false, '冻结来源快照未保留')
    assert(!document.body.textContent?.includes('创建后的最新来源'), '来源后续更新不得覆盖冻结快照')
    const syncedCase = useStore.getState().trades.find((trade) => trade.id === reviewCase.id)!
    assert(syncedCase.note === '<p>案例自己的结论</p>', '来源同步覆盖了案例沉淀')

    useStore.getState().updateNote(
      reviewCase.id,
      `<p>案例自己的结论</p><img src="${CASE_IMAGE_SRC}">`,
    )
    useStore.getState().updateNote(
      source.id,
      `<p>创建后的最新来源</p><img src="${SOURCE_IMAGE_SRC}">`,
    )
    root.unmount()
    root = null
    resetNoteDraftsForTests()
    root = createRoot(rootElement)
    renderDetail(root, `/trade/${reviewCase.ref}`)
    await waitFor(
      () => Boolean(
        findEditorImage('来源复盘正文', SOURCE_IMAGE_MARKER) &&
        findEditorImage('案例沉淀正文', CASE_IMAGE_MARKER),
      ),
      '案例双正文附件未就绪',
    )
    const sourceEditor = document.querySelector<HTMLElement>('[aria-label="来源复盘正文"]')
    const caseEditor = document.querySelector<HTMLElement>('[aria-label="案例沉淀正文"]')
    const sourceImage = findEditorImage('来源复盘正文', SOURCE_IMAGE_MARKER)
    const caseImage = findEditorImage('案例沉淀正文', CASE_IMAGE_MARKER)
    assert(sourceEditor && caseEditor && sourceImage && caseImage, '案例双正文附件挂载不完整')

    const navigationButton = findButton('切换到第二来源')
    assert(navigationButton, '缺少测试焦点锚点')
    navigationButton.focus()
    sourceEditor.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: -10_000,
      clientY: -10_000,
    }))
    await waitForFrame()
    assert(document.activeElement !== caseEditor, '来源正文空白点击不得聚焦案例 Editor')

    caseEditor.focus()
    assert(document.activeElement === caseEditor, '案例 Editor 无法建立焦点前置条件')
    sourceImage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    assert(document.activeElement === caseEditor, '来源图片双击不得操作案例 Editor 焦点')
    await waitFor(() => useShortcutStore.getState().lightbox !== null, '来源图片未打开灯箱')
    const sourceLightbox = useShortcutStore.getState().lightbox!
    assert(
      sourceLightbox.images.some((image) => image.includes(SOURCE_IMAGE_MARKER)) &&
      !sourceLightbox.images.some((image) => image.includes(CASE_IMAGE_MARKER)),
      '来源图片双击读取了案例 Editor 附件',
    )

    useShortcutStore.getState().closeLightbox()
    await waitFor(() => useShortcutStore.getState().lightbox === null, '来源灯箱未关闭')
    caseImage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await waitFor(() => useShortcutStore.getState().lightbox !== null, '案例图片未打开灯箱')
    const caseLightbox = useShortcutStore.getState().lightbox!
    assert(
      caseLightbox.images.some((image) => image.includes(CASE_IMAGE_MARKER)) &&
      !caseLightbox.images.some((image) => image.includes(SOURCE_IMAGE_MARKER)),
      '案例图片双击读取了来源 Editor 附件',
    )
    useShortcutStore.getState().closeLightbox()

    useStore.getState().removeTrade(source.id)
    useStore.getState().purgeTrade(source.id)
    await waitFor(
      () => document.body.textContent?.includes('来源已删除（来源不可用）') ?? false,
      '来源删除后必须使用共享的来源不可用状态',
    )
    assert(
      document.body.textContent?.includes('刚补充、尚未 idle 保存的复盘'),
      '来源清理后冻结快照必须可读',
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
    await waitFor(
      () => useToast.getState().message === '正文尚未保存，未创建案例',
      '草稿保存失败回执未出现',
    )
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
    const raceSourceA = { ...source, id: 'source-race-a', ref: 'TRD-RACE-A' }
    const raceSourceB = { ...source, id: 'source-race-b', ref: 'TRD-RACE-B' }
    useStore.setState({ trades: [raceSourceA, raceSourceB] })
    const firstSaveStarted = deferred<void>()
    const firstSave = deferred<string>()
    const secondSaveStarted = deferred<void>()
    const secondSave = deferred<string>()
    let slowSaveCalls = 0
    storage.saveAsset = async () => {
      slowSaveCalls += 1
      if (slowSaveCalls === 1) {
        firstSaveStarted.resolve()
        return firstSave.promise
      }
      if (slowSaveCalls === 2) {
        secondSaveStarted.resolve()
        return secondSave.promise
      }
      throw new Error('unexpected duplicate save')
    }
    root = createRoot(rootElement)
    renderDetail(root, '/trade/TRD-RACE-A')
    await waitFor(() => Boolean(findButton('更多')), '慢保存来源 A 详情未就绪')
    setNoteDraft(
      raceSourceA.id,
      '<p>来源 A 慢保存</p><img src="data:image/png;base64,QQ==">',
    )
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '来源 A 提炼入口未出现')
    findButton('提炼为案例')?.click()
    await firstSaveStarted.promise

    findButton('切换到第二来源')?.click()
    await waitFor(
      () => document.querySelector('[data-current-path]')?.textContent === '/trade/TRD-RACE-B',
      '慢保存期间未切换到来源 B',
    )
    await waitFor(() => Boolean(findButton('更多')), '慢保存来源 B 详情未就绪')
    setNoteDraft(
      raceSourceB.id,
      '<p>来源 B 慢保存</p><img src="data:image/png;base64,Qg==">',
    )
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '来源 B 提炼入口未出现')
    findButton('提炼为案例')?.click()
    await secondSaveStarted.promise

    firstSave.resolve('race-a-asset')
    await waitFor(() => !hasNoteDraft(raceSourceA.id), '来源 A 慢保存未完成')
    await waitForFrame()
    assert(
      !useStore.getState().trades.some((trade) => trade.sourceTradeId === raceSourceA.id),
      '切换详情后旧来源不得创建案例',
    )
    assert(
      document.querySelector('[data-current-path]')?.textContent === '/trade/TRD-RACE-B',
      '旧来源完成保存后不得抢回导航',
    )

    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '来源 B 重复提交入口未出现')
    findButton('提炼为案例')?.click()
    await waitForFrame()
    assert(slowSaveCalls === 2, '旧操作 finally 不得释放来源 B 的进行中锁')
    secondSave.resolve('race-b-asset')
    await waitFor(() => !hasNoteDraft(raceSourceB.id), '来源 B 慢保存未完成')
    await waitFor(
      () => useStore.getState().trades.filter((trade) => trade.sourceTradeId === raceSourceB.id).length > 0,
      '来源 B 案例未创建',
    )
    assert(
      useStore.getState().trades.filter((trade) => trade.sourceTradeId === raceSourceB.id).length === 1,
      '旧操作 finally 释放新锁后产生了重复案例',
    )

    root.unmount()
    root = null
    resetNoteDraftsForTests()
    const unmountSource = { ...source, id: 'source-unmount', ref: 'TRD-UNMOUNT' }
    useStore.setState({ trades: [unmountSource] })
    const unmountSaveStarted = deferred<void>()
    const unmountSave = deferred<string>()
    storage.saveAsset = async () => {
      unmountSaveStarted.resolve()
      return unmountSave.promise
    }
    root = createRoot(rootElement)
    renderDetail(root, '/trade/TRD-UNMOUNT')
    await waitFor(() => Boolean(findButton('更多')), '卸载竞态来源详情未就绪')
    setNoteDraft(
      unmountSource.id,
      '<p>卸载期间慢保存</p><img src="data:image/png;base64,Qw==">',
    )
    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('提炼为案例')), '卸载竞态提炼入口未出现')
    findButton('提炼为案例')?.click()
    await unmountSaveStarted.promise
    root.unmount()
    root = null
    unmountSave.resolve('unmount-asset')
    await waitFor(() => !hasNoteDraft(unmountSource.id), '卸载后的慢保存未完成')
    await waitForFrame()
    assert(
      !useStore.getState().trades.some((trade) => trade.tradeKind === 'case'),
      '详情卸载后旧操作不得创建案例',
    )

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
    useToast.getState().dismiss()
    useToast.setState(previousToast)
    useStore.setState(previousStore)
    useShortcutStore.setState(previousShortcuts)
  }
}

window.__reviewCaseSourceSyncTest = run()
