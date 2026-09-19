import { createRoot } from 'react-dom/client'
import { ImageLightbox } from './ImageLightbox'
import { useShortcutStore } from '@/store/shortcutStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __lightboxViewMemoryTest?: Promise<void> }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error(message)
}

const transform = () => document.querySelector<HTMLElement>('.img-lightbox-canvas')?.style.transform
const images = ['#5e6ad2', '#22c55e'].map((fill) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000"><rect width="1800" height="1000" fill="${fill}"/></svg>`,
)}`)

async function ready(index: number) {
  await waitFor(() => Boolean(
    document.querySelector('.img-lightbox-overlay.is-open')
    && document.querySelector<HTMLImageElement>('.img-lightbox-img.is-ready')?.src === images[index],
  ), `图片 ${index + 1} 未就绪`)
}

function zoomAtOffset() {
  const viewport = document.querySelector<HTMLElement>('.img-lightbox-viewport')!
  const rect = viewport.getBoundingClientRect()
  viewport.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -100,
    clientX: rect.left + rect.width / 2 + 120,
    clientY: rect.top + rect.height / 2 - 60,
    bubbles: true,
    cancelable: true,
  }))
}

async function run() {
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const previous = useShortcutStore.getState()
  try {
    root.render(<ImageLightbox />)
    useShortcutStore.getState().openLightbox(images, 0, 'first-case')
    await ready(0)
    const fit = transform()
    zoomAtOffset()
    await waitFor(() => transform() !== fit, '缩放未改变观察位置')
    const firstView = transform()
    useShortcutStore.getState().lightboxNext()
    await ready(1)
    assert(transform() === fit, '首次打开另一张图应适合窗口')
    zoomAtOffset()
    await waitFor(() => transform() !== fit, '第二张图片无法独立缩放')
    zoomAtOffset()
    await waitFor(() => transform() !== firstView, '第二张图片无法继续缩放')
    const secondView = transform()
    useShortcutStore.getState().lightboxPrev()
    await ready(0)
    assert(transform() === firstView, '返回第一张图片丢失缩放或平移')
    useShortcutStore.getState().lightboxNext()
    await ready(1)
    assert(transform() === secondView, '第二张图片没有保留独立观察位置')
    document.querySelector<HTMLButtonElement>('[aria-label="适合窗口"]')!.click()
    await waitFor(() => transform() === fit, '适合窗口没有重置当前图片')
    useShortcutStore.getState().lightboxPrev()
    await ready(0)
    assert(transform() === firstView, '重置第二张图片污染了第一张图片')
    useShortcutStore.getState().lightboxNext()
    await ready(1)
    assert(transform() === fit, '适合窗口的状态没有被记住')
    useShortcutStore.getState().closeLightbox()
    await waitFor(() => !document.querySelector('.img-lightbox-overlay'), '预览未关闭')
    useShortcutStore.getState().openLightbox(images, 0, 'first-case')
    await ready(0)
    assert(transform() === fit, '新一轮预览不应继承已结束会话的位置')
    const viewport = document.querySelector<HTMLElement>('.img-lightbox-viewport')!
    viewport.style.width = '480px'
    await waitFor(() => transform() !== fit, '适合模式应随观察窗口缩小重新计算')
    zoomAtOffset()
    const scaled = transform()
    await waitFor(() => transform() !== scaled, '用户缩放未生效')
    const manual = transform()
    viewport.style.width = '600px'
    await new Promise(resolve => setTimeout(resolve, 100))
    assert(transform() === manual, '窗口变化不应重置手动缩放和平移')
    document.querySelector<HTMLButtonElement>('[aria-label="适合窗口"]')!.click()
    await waitFor(() => transform() !== manual, '适合窗口应使用最新窗口尺寸')
    useShortcutStore.getState().openLightbox(['data:image/png;base64,broken'], 0, 'broken-image')
    await waitFor(() => Boolean(document.querySelector('.img-lightbox-loading[role="alert"]')), '失败图片必须显示可恢复状态')
    const close = document.querySelector<HTMLButtonElement>('.img-lightbox-close')!
    assert(getComputedStyle(close.closest('.img-lightbox-chrome')!).opacity === '1', '图片失败时关闭入口必须可见')
    const retry = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重新载入')!
    assert(retry, '失败时必须提供重新载入')
    let reachedCanvas = false
    document.querySelector<HTMLElement>('.img-lightbox-viewport')!.setPointerCapture = () => { reachedCanvas = true }
    retry.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    assert(!reachedCanvas, '重试按钮不得被画布拖拽捕获')
    retry.click()
    await waitFor(() => Boolean(document.querySelector('.img-lightbox-loading[role="alert"]')), '重试失败仍应允许关闭或再次重试')
    close.click()
    await waitFor(() => !document.querySelector('.img-lightbox-overlay'), '图片失败时关闭入口应可用')
  } finally {
    root.unmount()
    useShortcutStore.setState(previous, true)
  }
}

window.__lightboxViewMemoryTest = run()
