import { captureStoreForPersistence } from '@/store/persistedRevision'
import { createRoot } from 'react-dom/client'
import { CsvImportModal } from './CsvImportModal'
import { getStorage } from '@/storage/provider'
import { disablePersistWrites, enablePersistWrites } from '@/storage/persist'
import { toastStore } from '@/lib/toast'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __csvImportPersistenceTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForButton(text: string): Promise<HTMLButtonElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes(text))
    if (button) return button
    await waitForFrame()
  }
  throw new Error(`未找到按钮：${text}`)
}

async function waitForEnabledButton(text: string): Promise<HTMLButtonElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes(text) && !item.disabled)
    if (button) return button
    await waitForFrame()
  }
  throw new Error(`未找到可用按钮：${text}`)
}

async function waitForFileInput(): Promise<HTMLInputElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (input) return input
    await waitForFrame()
  }
  throw new Error('CSV 导入应提供文件输入')
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const originalConsoleError = console.error
  const attemptedSnapshots: string[][] = []
  let unhandledRejections = 0
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    unhandledRejections += 1
    event.preventDefault()
  }

  disablePersistWrites()
  toastStore.dismiss()
  useStore.setState({
    trades: [],
    strategies: [{ id: 'strategy-test', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
  })
  storage.saveSnapshot = async (snapshot) => {
    attemptedSnapshots.push(snapshot.trades.map((trade) => trade.id))
    throw new Error('disk full')
  }
  console.error = () => {}
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  try {
    enablePersistWrites(captureStoreForPersistence)
    root.render(<CsvImportModal open onClose={() => {}} />)

    const input = await waitForFileInput()
    const files = new DataTransfer()
    files.items.add(new File([
      ['symbol,side,status,strategy,size,openedAt', ...Array.from({ length: 25 }, (_, index) =>
        `S${index + 1},long,open,测试策略,1,2026-07-14`)].join('\n'),
    ], 'trades.csv', { type: 'text/csv' }))
    Object.defineProperty(input, 'files', { configurable: true, value: files.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const previewButton = await waitForButton('预览导入')
    previewButton.click()
    const importButton = await waitForEnabledButton('确认导入')
    const pageButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    for (let page = 1; page <= 3; page += 1) {
      const next = pageButton('下一页记录')
      assert(next && !next.disabled, '长文件应能翻到最后一页')
      next.click()
      await waitForFrame()
    }
    assert(pageButton('下一页记录')?.disabled, '最后一页不应继续翻页')
    const lastRecords = document.querySelectorAll('.import-preview-list > li')
    assert(lastRecords.length === 1 && lastRecords[0]?.textContent?.includes('S25'), '末页应显示曾被截断的第 25 笔记录')
    pageButton('上一页记录')?.click()
    await waitForFrame()
    assert(document.querySelectorAll('.import-preview-list > li').length === 8, '翻回上一页应只渲染当页记录')
    importButton.click()

    await new Promise((resolve) => window.setTimeout(resolve, 80))
    assert(
      document.body.textContent?.includes('导入失败，交易未能安全保存，请重试'),
      'CSV 写盘失败后应在当前步骤显示可重试错误',
    )
    assert(!document.body.textContent?.includes('导入完成'), '写盘失败不得进入导入完成步骤')
    assert(!toastStore.getVisible().some(item => item.message.includes('成功导入')), '写盘失败不得显示成功 toast')
    assert(unhandledRejections === 0, 'CSV 写盘失败不得产生未处理 Promise rejection')
    assert(useStore.getState().trades.length === 0, 'CSV 写盘失败必须回滚本批新增交易')
    assert(attemptedSnapshots.some((ids) => ids.length === 25), '确认导入应提交所有页的有效记录')
    assert(attemptedSnapshots.length >= 2, '回滚后必须用最新 store 再次覆盖待写快照')
    assert(
      attemptedSnapshots.at(-1)?.length === 0,
      '失败后保留的待写快照不得继续包含已回滚批次',
    )
  } finally {
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    console.error = originalConsoleError
    disablePersistWrites()
    storage.saveSnapshot = originalSaveSnapshot
    root.unmount()
  }
}

window.__csvImportPersistenceTest = run()
