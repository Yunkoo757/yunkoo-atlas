import { createRoot } from 'react-dom/client'
import { WebStorageGuard } from '@/components/WebStorageGuard'
import {
  assertWebWriteAllowed,
  getWebWriteGuardState,
  initializeWebWriterOwnership,
  reportWebRevisionConflict,
  resetWebWriteGuardForTests,
  type WebLockManagerLike,
} from '@/storage/webWriteGuard'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'

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
  const adapter = getIndexedDbAdapter()
  await adapter.open()
  const preparedId = await adapter.saveAsset(new Blob(['prepared'], { type: 'image/png' }), 'image/png')
  const originalQuickNotes = useStore.getState().quickNotes
  useStore.setState({
    quickNotes: [{
      id: 'conflict-recovery-note',
      title: '抢救导出',
      contentHtml: `<img src="journal-asset://${preparedId}"><img src="journal-asset://missing-recovery-asset">`,
      pinned: false,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    }],
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

  let recoveryBlob: Blob | null = null
  let recoveryFilename = ''
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  const originalAnchorClick = HTMLAnchorElement.prototype.click
  URL.createObjectURL = (blob) => {
    if (blob instanceof Blob) recoveryBlob = blob
    return 'blob:conflict-recovery-test'
  }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function captureRecoveryDownload() {
    recoveryFilename = this.download
  }
  try {
    const exportButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('导出本标签页未保存副本'),
    )
    assert(exportButton, '冲突恢复导出按钮必须可操作')
    exportButton.click()
    await waitFor(
      () => document.querySelector('[role="status"]')?.textContent?.includes('明确缺少 1 个附件') === true,
      '恢复导出必须在 UI 中明确显示缺失附件数量',
    )
    assert(recoveryFilename.includes('recovery-incomplete'), '缺附件恢复副本文件名必须显式标记 incomplete')
    const capturedBlob = recoveryBlob as Blob | null
    assert(capturedBlob instanceof Blob, '恢复导出必须生成真实 JSON Blob')
    const recoveryPayload = JSON.parse(await capturedBlob.text()) as {
      assets?: Array<{ id: string }>
      recovery?: { missingAssetIds?: string[] }
    }
    assert(recoveryPayload.assets?.some((asset) => asset.id === preparedId), '恢复副本必须包含本标签页 prepared 附件')
    assert(
      JSON.stringify(recoveryPayload.recovery?.missingAssetIds) === JSON.stringify(['missing-recovery-asset']),
      '恢复副本必须逐项记录真实缺失附件 ID',
    )
  } finally {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    HTMLAnchorElement.prototype.click = originalAnchorClick
    useStore.setState({ quickNotes: originalQuickNotes })
    adapter.close()
  }

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

  const grantedLockManager: WebLockManagerLike = {
    async request(name, _options, callback) {
      return callback({ name })
    },
  }
  await initializeWebWriterOwnership('browser-lock-loss', {
    lockManager: grantedLockManager,
    broadcastFactory: null,
  })
  assert(getWebWriteGuardState().phase === 'editable', '测试必须先真实持有 Web writer lock')
  useSaveStatus.getState().setDirty()
  window.dispatchEvent(new Event('pagehide'))
  const lostState = getWebWriteGuardState()
  assert(
    lostState.phase === 'readonly' && lostState.reason === 'lock-lost',
    '页面隐藏释放锁后必须立即进入 lock-lost 只读态',
  )
  let writeRejected = false
  try {
    assertWebWriteAllowed()
  } catch {
    writeRejected = true
  }
  assert(writeRejected, '丢锁后所有 Web 写入口必须被冻结')
  assert(useSaveStatus.getState().status === 'dirty', '丢锁时未确认编辑不得显示为已保存')
  const lostRoot = createRoot(rootElement)
  lostRoot.render(<WebStorageGuard />)
  await waitFor(() => document.body.textContent?.includes('编辑权已失效') === true, '丢锁必须展示不可忽略的恢复 UI')
  lostRoot.unmount()
  useSaveStatus.getState().reset()
  resetWebWriteGuardForTests()
}

window.__webStorageConflictGuardTest = run()
