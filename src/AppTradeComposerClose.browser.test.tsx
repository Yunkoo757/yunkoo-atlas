import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapStorage, getStorage } from '@/storage/bootstrap'
import { collectAssetIdsFromHtml } from '@/storage/assets'
import { useStore } from '@/store/useStore'
import type { JournalBridge } from '@/types/journalBridge'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __appTradeComposerCloseTest?: Promise<void> } }

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
async function until(check: () => unknown, message: string) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) { if (check()) return; await frame() }
  throw Error(message)
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function button(scope: ParentNode, label: string) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.textContent?.trim() === label && !item.closest('.ui-exit-clone'))
  assert(found, `缺少按钮：${label}`)
  return found
}
const composer = () => document.querySelector<HTMLElement>('[role="dialog"].composer-modal')
const receipt = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
  .find(panel => panel.querySelector('h2')?.textContent === '保存未完成，已取消退出')

async function run() {
  // Bootstrap a new browser-only IndexedDB before installing the fake native close bridge.
  await bootstrapStorage()
  const previous = useStore.getState(), bridge = window.journalBridge, storage = getStorage()
  const originalCommit = storage.commitImport
  const callbacks: { close: (() => void | Promise<void>) | null; error: ((message: string) => void) | null } = { close: null, error: null }
  const commits: { gate: ReturnType<typeof deferred> | null; count: number } = { gate: null, count: 0 }
  storage.commitImport = async (...args) => {
    commits.count++
    if (commits.gate) await commits.gate.promise
    return originalCommit.apply(storage, args)
  }
  Object.assign(window, { __atlasBrowserAllowedErrors: ['[TradeComposer] quick create failed'] })
  window.journalBridge = {
    isElectron: true, platform: 'darwin',
    getLibraryStatus: async () => ({ kind: 'ready' }),
    onTrayNavigate: () => () => {},
    onBeforeClose: (callback: () => void | Promise<void>) => { callbacks.close = callback; return () => { callbacks.close = null } },
    onCloseSaveError: (callback: (message: string) => void) => { callbacks.error = callback; return () => { callbacks.error = null } },
  } as unknown as JournalBridge
  const root = createRoot(document.getElementById('root')!)
  const askClose = async () => {
    assert(callbacks.close, 'App没有注册原生关闭握手')
    try { await callbacks.close(); return null } catch (error) {
      // The real main process sends this second error receipt after a rejected renderer ACK.
      callbacks.error?.(error instanceof Error ? error.message : String(error))
      return error
    }
  }
  try {
    useStore.setState({ trades: [], symbolCatalog: ['BTCUSDT'], composerOpen: false, composerTrade: null })
    window.location.hash = '/today'
    root.render(<App />)
    await until(() => document.documentElement.dataset.uiSettled === '1' && callbacks.close, 'App未完成隔离启动')
    useStore.getState().openComposer(null, 'live')
    await until(() => composer()?.querySelector('#composer-quick-text'), '新建交易未打开')
    const input = composer()!.querySelector<HTMLInputElement>('#composer-quick-text')!
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([png], 'native-close.png', { type: 'image/png' }))
    const upload = composer()!.querySelector<HTMLInputElement>('input[type="file"]')!
    upload.files = transfer.files
    upload.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => composer()?.querySelector('img[alt="预览"]'), '待提交原图没有显示')
    const preview = composer()!.querySelector<HTMLImageElement>('img[alt="预览"]')!
    await preview.decode()
    const previewUrl = preview.src
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '退出检查期间保留的草稿')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await frame()
    assert(input.value === '退出检查期间保留的草稿', '测试输入必须先进入React表单状态')

    assert(await askClose() instanceof Error, '未提交草稿必须拒绝正常原生退出')
    await until(() => receipt(), '草稿拒绝退出必须提供可操作的顶层回执')
    await until(() => document.activeElement === button(receipt()!, '继续使用'), '回执主按钮必须可由键盘操作')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    assert(receipt()!.contains(document.activeElement), '顶层回执必须保留自己的键盘焦点范围')
    button(receipt()!, '继续使用').click()
    await until(() => !receipt(), '继续使用必须撤回回执')
    assert(input.value === '退出检查期间保留的草稿' && preview.src === previewUrl && composer(), '拒绝退出不得重置文字或原图')
    assert((await fetch(previewUrl)).ok && useStore.getState().trades.length === 0, '拒绝退出不得失效原图或暗中创建交易')

    commits.gate = deferred()
    button(composer()!, '保存记录').click()
    await until(() => commits.count === 1, '保存没有进入隔离提交')
    let closeSettled = false
    const failedClose = askClose().then(error => { closeSettled = true; return error })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert(!closeSettled, '关闭必须先等待在途提交，不能提早检查草稿')
    commits.gate.reject(Error('isolated composer commit failure'))
    assert(await failedClose instanceof Error, '提交失败后仍未保存的表单必须拒绝退出')
    commits.gate = null
    await until(() => receipt(), '提交失败后必须回到可继续编辑的回执')
    button(receipt()!, '继续使用').click()
    await until(() => !receipt() && !button(composer()!, '保存记录').disabled, '提交失败必须允许重试保存')
    assert(input.value === '退出检查期间保留的草稿' && (await fetch(previewUrl)).ok && useStore.getState().trades.length === 0, '失败关闭必须保留草稿原图且不生成重复记录')

    commits.gate = deferred()
    button(composer()!, '保存记录').click()
    await until(() => commits.count === 2, '重试没有再次进入提交')
    const successfulClose = askClose()
    commits.gate.resolve()
    assert(await successfulClose === null, '在途保存成功并关闭表单后不得误拦退出')
    commits.gate = null
    assert(!useStore.getState().composerOpen && useStore.getState().trades.length === 1, '保存重试必须只创建一笔交易')
    const saved = useStore.getState().trades[0]
    const assets = collectAssetIdsFromHtml([saved.note])
    assert(saved.note.includes('退出检查期间保留的草稿') && assets.length === 1 && await storage.getAssetForExport(assets[0]), '最终保存必须保留草稿文字及可导出的原图')
    assert(document.querySelector('.app-close-save.is-saved') && !receipt(), '成功关闭沿用现有安全保存回执')
  } finally {
    commits.gate?.resolve()
    root.unmount()
    storage.commitImport = originalCommit
    window.journalBridge = bridge
    useStore.setState(previous, true)
  }
}

window.__appTradeComposerCloseTest = run()
