import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  clearReviewSessionStorage,
  saveReviewSession,
} from '@/lib/reviewSession'
import { bootstrapStorage, getStorage } from '@/storage'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { ReviewSessionView } from '@/views/ReviewSessionView'

declare global {
  interface Window {
    __reviewSessionImageReadinessTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 8_000
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

function svgSource(marker: string, fill: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><title>${marker}</title><rect width="400" height="240" fill="${fill}"/></svg>`,
  )}`
}

function galleryRects(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>('.review-session-gallery-slot')]
    .map((slot) => slot.getBoundingClientRect())
}

function assertRectsEqual(before: DOMRect[], after: DOMRect[], message: string): void {
  assert(before.length === after.length, message)
  const stable = before.every((rect, index) => {
    const next = after[index]
    return Boolean(next) && ['x', 'y', 'width', 'height'].every(
      (key) => Math.abs(rect[key as keyof DOMRect] as number - (next[key as keyof DOMRect] as number)) < 0.5,
    )
  })
  assert(stable, message)
}

const strategy: Strategy = {
  id: 'image-readiness-strategy',
  name: '图片时序策略',
  icon: 'target',
  color: '#5e6ad2',
}

function reviewCase(id: string, ref: string, note: string): Trade {
  return {
    id,
    ref,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
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
    closedTradingDayKey: '2026-07-16',
    note,
  }
}

const firstFast = svgSource('fast-first', '#5e6ad2')
const firstSlow = svgSource('slow-second', '#14b8a6')
const staleFast = svgSource('stale-first', '#8b5cf6')
const staleSlow = svgSource('stale-second', '#f59e0b')
const thirdOnly = svgSource('third-only', '#22c55e')
const fourthReady = svgSource('fourth-ready', '#3b82f6')
const fourthBroken = svgSource('broken-image', '#ef4444')
const cases = [
  reviewCase('image-case-first', 'CAS-IMG-1', `<img alt="第一张" src="${firstFast}"><img alt="第二张" src="${firstSlow}">`),
  reviewCase('image-case-stale', 'CAS-IMG-2', `<img alt="旧请求一" src="${staleFast}"><img alt="旧请求二" src="${staleSlow}">`),
  reviewCase('image-case-third', 'CAS-IMG-3', `<img alt="第三条" src="${thirdOnly}">`),
  reviewCase('image-case-broken', 'CAS-IMG-4', `<img alt="可用图" src="${fourthReady}"><img alt="损坏图" src="${fourthBroken}">`),
]

async function run(): Promise<void> {
  await bootstrapStorage()
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const manifest = await getStorage().getManifest()
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const slowGate = deferred<void>()
  const staleGate = deferred<void>()
  let staleDecodeStarted = false
  const originalDecode = HTMLImageElement.prototype.decode
  HTMLImageElement.prototype.decode = function () {
    if (this.src.includes('slow-second')) return slowGate.promise
    if (this.src.includes('stale-second')) {
      staleDecodeStarted = true
      return staleGate.promise
    }
    if (this.src.includes('broken-image')) return Promise.reject(new Error('decode failed'))
    return Promise.resolve()
  }

  clearReviewSessionStorage(manifest.libraryId)
  useStore.setState({
    trades: cases,
    strategies: [strategy],
    starredIds: [],
    composerOpen: false,
    closeTradeRequest: null,
  })
  useShortcutStore.setState({
    lightbox: null,
    cmdkOpen: false,
    modalOverlayCount: 0,
  })
  assert(saveReviewSession(manifest.libraryId, {
    ids: cases.map((item) => item.id),
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    assessments: {},
  }), '无法写入已恢复的图片时序会话')

  const root = createRoot(rootElement)
  root.render(
    <MemoryRouter
      initialEntries={['/review-session']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ReviewSessionView />
    </MemoryRouter>,
  )

  try {
    await waitFor(() => document.querySelectorAll('.review-session-gallery-slot.is-loading').length === 2,
      '延迟图片期间没有渲染最终数量的骨架槽位')
    const loadingGallery = document.querySelector<HTMLElement>('.review-session-gallery')
    assert(loadingGallery?.getAttribute('aria-busy') === 'true', '图片组 settling 期间必须标记 aria-busy')
    const loadingStatuses = loadingGallery.querySelectorAll<HTMLElement>('[role="status"]')
    assert(loadingStatuses.length === 1, '图片组只能提供一个加载状态播报')
    assert(loadingStatuses[0]?.textContent?.trim() === '交易截图载入中…', '图片组缺少简洁的加载状态文案')
    const loadingStatusRect = loadingStatuses[0]?.getBoundingClientRect()
    assert(Boolean(loadingStatusRect && loadingStatusRect.width <= 1 && loadingStatusRect.height <= 1),
      '图片组加载状态必须在视觉上隐藏')
    assert(document.querySelectorAll('.review-session-gallery img').length === 0,
      '整组完成前不得提前暴露第一张图片')
    const before = galleryRects()
    slowGate.resolve()
    await waitFor(() => document.querySelectorAll('.review-session-gallery img').length === 2,
      '全部解码后没有原子显示整组图片')
    assert(loadingGallery?.getAttribute('aria-busy') === 'false', '图片组 settled 后必须清除 aria-busy')
    assert(loadingGallery?.querySelectorAll('[role="status"]').length === 0, '图片组 settled 后不得保留加载播报')
    assertRectsEqual(before, galleryRects(), '图片就绪前后画廊几何尺寸发生变化')

    findButton('跳过 N')?.click()
    await waitFor(() => staleDecodeStarted, '第二条旧请求没有进入延迟解码')
    findButton('跳过 N')?.click()
    await waitFor(() => document.querySelector<HTMLImageElement>('.review-session-gallery img')?.src.includes('third-only') === true,
      '立即推进后没有显示第三条图片')
    const thirdSources = [...document.querySelectorAll<HTMLImageElement>('.review-session-gallery img')].map((image) => image.src).join(',')
    const thirdErrors = document.querySelectorAll('.review-session-gallery-slot.is-error').length
    staleGate.resolve()
    await waitForFrame()
    await waitForFrame()
    assert([...document.querySelectorAll<HTMLImageElement>('.review-session-gallery img')].map((image) => image.src).join(',') === thirdSources,
      '旧请求完成后覆盖了当前交易图片')
    assert(document.querySelectorAll('.review-session-gallery-slot.is-error').length === thirdErrors,
      '旧请求完成后污染了当前交易错误状态')

    findButton('跳过 N')?.click()
    await waitFor(() => document.querySelectorAll('.review-session-gallery-slot.is-error').length === 1,
      '损坏图片没有形成稳定错误槽位')
    assert(document.querySelector('.review-session-gallery-slot.is-error')?.textContent?.includes('图片暂时无法显示'),
      '错误槽位缺少指定提示')
    const readyButton = document.querySelector<HTMLButtonElement>('.review-session-gallery-slot.is-ready')
    assert(readyButton, '同组成功图片没有保留可用槽位')
    readyButton.click()
    assert(useShortcutStore.getState().lightbox?.images.join(',') === fourthReady,
      '灯箱不得包含解码失败的图片来源')
    assert(useShortcutStore.getState().lightbox?.index === 0,
      '失败槽位前后的灯箱索引映射不正确')
  } finally {
    root.unmount()
    HTMLImageElement.prototype.decode = originalDecode
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      starredIds: previous.starredIds,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      composerOpen: previous.composerOpen,
      closeTradeRequest: previous.closeTradeRequest,
    })
    useShortcutStore.setState({
      lightbox: previousShortcuts.lightbox,
      cmdkOpen: previousShortcuts.cmdkOpen,
      modalOverlayCount: previousShortcuts.modalOverlayCount,
    })
  }
}

window.__reviewSessionImageReadinessTest = run()
