import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TradeComposer } from '@/components/TradeComposer'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { useStore } from '@/store/useStore'
import { assertTradeComposerDraftCanClose } from '@/lib/tradeComposerDraftGuard'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __tradeComposerPreviewLifecycleTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

const composer = () => document.querySelector<HTMLElement>('[role="dialog"].composer-modal')

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('[role="dialog"] button, button')]
    .find((item) => item.textContent?.trim() === label && !item.closest('.ui-exit-clone'))
  assert(found, `缺少按钮：${label}`)
  return found
}

async function run(): Promise<void> {
  const originalState = useStore.getState()
  const storage = getIndexedDbAdapter()
  await storage.open()
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const created = new Set<string>()
  const revoked = new Map<string, number>()
  URL.createObjectURL = (blob) => {
    const url = originalCreate.call(URL, blob)
    created.add(url)
    return url
  }
  URL.revokeObjectURL = (url) => {
    revoked.set(url, (revoked.get(url) ?? 0) + 1)
    originalRevoke.call(URL, url)
  }
  // Keep real ModalShell exit clones alive long enough to inspect resource ownership.
  const style = document.createElement('style')
  style.textContent = '.ui-exit-clone { animation-duration: 30s !important; }'
  document.head.append(style)
  const host = document.createElement('div')
  document.body.append(host)
  let root: Root | null = createRoot(host)
  const mount = () => flushSync(() => root!.render(
    <StrictMode><MemoryRouter><TradeComposer /></MemoryRouter></StrictMode>,
  ))
  const pngCanvas = document.createElement('canvas')
  pngCanvas.width = pngCanvas.height = 2
  pngCanvas.getContext('2d')!.fillRect(0, 0, 2, 2)
  const png = await new Promise<Blob>((resolve) => pngCanvas.toBlob((blob) => resolve(blob!), 'image/png'))

  const upload = async (): Promise<string> => {
    useStore.setState({ composerOpen: true, composerTrade: null, composerKind: 'live' })
    await waitFor(() => Boolean(composer()), '新建交易没有打开')
    const input = composer()!.querySelector<HTMLInputElement>('input[type="file"]')
    assert(input, '缺少截图上传控件')
    const transfer = new DataTransfer()
    transfer.items.add(new File([png], 'preview.png', { type: 'image/png' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => Boolean(composer()?.querySelector('img[alt="预览"]')), '截图预览没有出现')
    const image = composer()!.querySelector<HTMLImageElement>('img[alt="预览"]')!
    await image.decode()
    assert(image.naturalWidth === 2, '真实 PNG 预览必须可读取')
    assert(!revoked.has(image.src), '显示中的预览不得回收')
    return image.src
  }

  const finishExit = async (url: string, action: string): Promise<void> => {
    await waitFor(() => !composer(), `${action}没有关闭交易弹窗`)
    await waitFor(() => [...document.querySelectorAll('.ui-exit-clone img')]
      .some((image) => image.getAttribute('src') === url), `${action}没有保留真实离场快照`)
    await task()
    await task()
    const clones = [...document.querySelectorAll<HTMLElement>('.ui-exit-clone')]
      .filter((clone) => [...clone.querySelectorAll('img')].some((image) => image.getAttribute('src') === url))
    assert(clones.length > 0 && clones.every((clone) => clone.isConnected), `${action}快照必须仍在文档中`)
    assert(!revoked.has(url), `${action}快照移除前不得回收预览 URL`)
    const response = await fetch(url)
    assert(response.ok && (await response.blob()).size === png.size, `${action}快照所用原图必须仍可读取`)
    for (const clone of clones) {
      const image = clone.querySelector<HTMLImageElement>('img[alt="预览"]')!
      await image.decode()
      assert(image.naturalWidth === 2, `${action}离场快照图片不可失效`)
      clone.remove()
    }
    await waitFor(() => revoked.get(url) === 1, `${action}快照移除后必须释放预览 URL`)
  }

  try {
    useStore.setState({ trades: [], symbolCatalog: ['BTCUSDT'], composerOpen: false, composerTrade: null })
    mount()
    assertTradeComposerDraftCanClose()

    const saved = await upload()
    let blocked = false
    try { assertTradeComposerDraftCanClose() } catch { blocked = true }
    assert(blocked, 'StrictMode 初始化后未提交截图必须阻止退出')
    button('保存记录', composer()!).click()
    await finishExit(saved, '保存')
    assertTradeComposerDraftCanClose()
    assert(useStore.getState().trades.length === 1, '保存必须创建交易')
    const note = useStore.getState().trades[0].note
    assert(note.includes('journal-asset://') && !note.includes('blob:'), '交易必须保存持久附件引用')

    const cancelled = await upload()
    button('取消', composer()!).click()
    await waitFor(() => [...document.querySelectorAll('[role="dialog"]')]
      .some((dialog) => dialog.textContent?.includes('放弃未保存的修改？')), '取消必须保留修改确认')
    assert(!revoked.has(cancelled), '确认放弃前仍在显示的预览不得回收')
    button('继续编辑').click()
    await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1, '继续编辑必须返回原表单')
    assert(composer()?.querySelector('img[alt="预览"]')?.getAttribute('src') === cancelled, '继续编辑必须保留同一张未提交预览')
    button('取消', composer()!).click()
    await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2, '再次取消必须仍可明确放弃')
    button('放弃修改').click()
    await finishExit(cancelled, '取消并放弃')
    assertTradeComposerDraftCanClose()
    assert(useStore.getState().trades.length === 1, '放弃截图不得新增交易')

    const deleted = await upload()
    const remove = composer()!.querySelector<HTMLButtonElement>('[aria-label="删除图片"]')
    assert(remove, '缺少删除图片按钮')
    remove.click()
    await waitFor(() => !composer()?.querySelector('img[alt="预览"]'), '删除后预览必须移除')
    await waitFor(() => revoked.get(deleted) === 1, '没有离场消费者的删除预览必须释放')
    button('取消', composer()!).click()
    await waitFor(() => !composer(), '删除后空白交易应直接取消')
    await task()
    assert(revoked.get(deleted) === 1, '删除后关闭不得重复回收')

    const unmounted = await upload()
    flushSync(() => root!.unmount())
    root = null
    assertTradeComposerDraftCanClose()
    await finishExit(unmounted, '组件卸载')
    await task()
    assert(created.size === 4, '本回归必须覆盖四张独立预览')
    assert([...created].every((url) => revoked.get(url) === 1), '保存、取消、删除和卸载必须各释放一次且无遗漏')
  } finally {
    root?.unmount()
    await task()
    document.querySelectorAll('.ui-exit-clone').forEach((clone) => clone.remove())
    await task()
    for (const url of created) if (!revoked.has(url)) originalRevoke.call(URL, url)
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    host.remove()
    style.remove()
    useStore.setState(originalState)
    storage.close()
  }
}

window.__tradeComposerPreviewLifecycleTest = run()
