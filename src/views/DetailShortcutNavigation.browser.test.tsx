import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { ImageLightbox } from '@/components/ImageLightbox'

declare global {
  interface Window {
    __detailShortcutNavigationTest?: Promise<void>
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

function makeCase(index: number): Trade {
  return {
    id: `case-${index}`,
    ref: `CAS-${index}`,
    symbol: `CASE${index}`,
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'uncategorized',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: `2026-07-${10 + index}`,
    closedAt: `2026-07-${10 + index}`,
    note: index === 1
      ? `<p>案例 ${index} 的复盘正文</p>`
      : `<p>案例 ${index} 的复盘正文</p><img src="https://atlas.test/case-${index}.png">`,
  }
}

function ShortcutDetailFixture() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return <>
    <Routes>
      <Route path="/trade/:id" element={<DetailView />} />
    </Routes>
    <ImageLightbox />
  </>
}

function pressShortcut(key: 'q' | 'e'): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const cases = [makeCase(1), makeCase(2), makeCase(3)]
  const root = createRoot(rootElement)
  const pageErrors: string[] = []
  const capturePageError = (event: ErrorEvent) => pageErrors.push(event.error?.message ?? event.message)
  window.addEventListener('error', capturePageError)

  try {
    useStore.setState({ trades: cases })
    useShortcutStore.setState({
      bindings: {
        ...previousShortcuts.bindings,
        'trade.prev': { key: 'q' },
        'trade.next': { key: 'e' },
      },
      listContext: {
        filter: { type: 'all', tradeKind: 'case' },
        listPath: '/review-cases',
        listSearch: '',
        orderedIds: cases.map((item) => item.id),
      },
    })

    root.render(
      <MemoryRouter initialEntries={['/trade/CAS-2']}>
        <ShortcutDetailFixture />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('.ProseMirror')?.textContent?.includes('案例 2') ?? false,
      '初始案例正文未载入',
    )

    const initialImage = document.querySelector<HTMLImageElement>('.ProseMirror img')
    assert(initialImage, '案例正文缺少用于打开全屏的图片')
    initialImage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-2.png') ?? false,
      '初始案例图片未打开',
    )
    pressShortcut('e')
    await waitFor(
      () => document.body.textContent?.includes('CAS-3') ?? false,
      '全屏图片打开时未切换到下一案例',
    )
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-3.png') ?? false,
      '切换案例后全屏图片仍停留在旧案例',
    )
    pressShortcut('q')
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-2.png') ?? false,
      '返回上一案例后全屏图片未同步恢复',
    )
    pressShortcut('q')
    await waitFor(
      () => useShortcutStore.getState().lightbox === null,
      '切换到无图案例时应退出全屏图片',
    )
    pressShortcut('e')
    await waitFor(
      () => document.body.textContent?.includes('CAS-2') ?? false,
      '无图案例退出全屏后未能继续切换',
    )

    const sequence: Array<['q' | 'e', string]> = [
      ['e', 'CAS-3'],
      ['q', 'CAS-2'],
      ['q', 'CAS-1'],
      ['e', 'CAS-2'],
      ['e', 'CAS-3'],
      ['q', 'CAS-2'],
      ['q', 'CAS-1'],
      ['e', 'CAS-2'],
    ]
    for (const [key, expectedRef] of sequence) {
      pressShortcut(key)
      await waitFor(
        () => document.body.textContent?.includes(expectedRef) || pageErrors.length > 0,
        `按 ${key.toUpperCase()} 后未切换到 ${expectedRef}`,
      )
      if (pageErrors.length > 0) break
      await waitForFrame()
    }

    assert(
      !pageErrors.some((message) => message.includes('removeChild')),
      `Q/E 切换案例触发页面异常：${pageErrors.join(' | ')}`,
    )
    assert(pageErrors.length === 0, `Q/E 切换案例出现未处理异常：${pageErrors.join(' | ')}`)
    assert(document.querySelector('.ProseMirror'), '连续切换后案例编辑器不应丢失')
  } finally {
    window.removeEventListener('error', capturePageError)
    root.unmount()
    useStore.setState({
      trades: previousStore.trades,
      strategies: previousStore.strategies,
    })
    useShortcutStore.setState({
      bindings: previousShortcuts.bindings,
      listContext: previousShortcuts.listContext,
      lightbox: previousShortcuts.lightbox,
    })
  }
}

window.__detailShortcutNavigationTest = run()
