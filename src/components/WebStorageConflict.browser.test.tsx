import { createRoot } from 'react-dom/client'
import { WebStorageGuard } from '@/components/WebStorageGuard'
import {
  initializeWebWriterOwnership,
  reportWebRevisionConflict,
  resetWebWriteGuardForTests,
  type WebLockManagerLike,
} from '@/storage/webWriteGuard'

declare global {
  interface Window {
    __webStorageConflictGuardTest?: Promise<void>
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

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)

  resetWebWriteGuardForTests()
  await initializeWebWriterOwnership('browser-conflict', {
    lockManager: null,
    broadcastFactory: null,
  })
  reportWebRevisionConflict(4, 5)
  root.render(<WebStorageGuard />)
  await waitFor(() => document.body.textContent?.includes('检测到资料库写入冲突') === true, 'CAS 冲突必须显示阻塞 modal')

  const conflictText = document.body.textContent ?? ''
  assert(conflictText.includes('导出本标签页未保存副本'), '冲突 modal 必须提供本标签页抢救导出')
  assert(conflictText.includes('加载资料库最新版'), '冲突 modal 必须提供加载最新版')
  const buttonLabels = [...document.querySelectorAll('button')].map((button) => button.textContent ?? '')
  assert(!buttonLabels.some((label) => label.includes('强制覆盖')), '冲突 modal 不得提供 force overwrite 按钮')
  assert(!document.querySelector('[aria-label="关闭"]'), '冲突 modal 不得出现关闭入口')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitForFrame()
  assert(document.body.textContent?.includes('检测到资料库写入冲突'), 'Escape 不得绕过冲突 modal')

  root.unmount()
  resetWebWriteGuardForTests()
  const lockManager: WebLockManagerLike = {
    async request(_name, _options, callback) {
      return callback(null)
    },
  }
  await initializeWebWriterOwnership('browser-readonly', { lockManager, broadcastFactory: null })
  const readonlyRoot = createRoot(rootElement)
  readonlyRoot.render(<WebStorageGuard />)
  await waitFor(() => document.body.textContent?.includes('资料库已在另一标签页编辑') === true, '未取得 Web Lock 时必须显示只读 modal')
  const readonlyText = document.body.textContent ?? ''
  assert(readonlyText.includes('请求编辑权'), '只读 modal 必须提供等待式编辑权请求')
  assert(readonlyText.includes('加载资料库最新版'), '只读 modal 必须允许刷新到最新版')
  readonlyRoot.unmount()
  resetWebWriteGuardForTests()
}

window.__webStorageConflictGuardTest = run()
