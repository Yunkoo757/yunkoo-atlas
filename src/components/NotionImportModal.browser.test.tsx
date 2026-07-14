import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { NotionImportModal } from './NotionImportModal'
import { getStorage } from '@/storage'
import { disablePersistWrites, enablePersistWrites } from '@/storage/persist'
import { useToast } from '@/lib/toast'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __notionImportPersistenceTest?: Promise<void>
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
  throw new Error('Notion 导入应提供文件输入')
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const originalSaveAsset = storage.saveAsset.bind(storage)
  const originalCommitImport = storage.commitImport.bind(storage)
  const originalGetAssetStats = storage.getAssetStats.bind(storage)
  const originalConsoleError = console.error
  const attemptedCommits: Array<{
    tradeIds: string[]
    strategyIds: string[]
    assets: { id: string; mime: string; data: string }[]
  }> = []
  const capacityError =
    '本次原图总量超过 96 MB，请分批导入；为保留画质，软件不会自动压缩原图'
  let saveAssetCalls = 0
  let unhandledRejections = 0
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    unhandledRejections += 1
    event.preventDefault()
  }

  disablePersistWrites()
  useToast.setState({ message: null })
  useStore.setState({
    trades: [{
      id: 'existing-trade',
      ref: 'TRD-1',
      symbol: 'EURUSD',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'existing-strategy',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      tradeKind: 'live',
      entry: 1,
      exit: null,
      stopLoss: null,
      initialStopLoss: null,
      size: 1,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-13',
      closedAt: null,
      note: '',
    }],
    strategies: [{
      id: 'existing-strategy',
      name: '现有策略',
      icon: 'target',
      color: '#5e6ad2',
    }],
  })
  storage.saveSnapshot = async () => {}
  storage.getAssetStats = async (ids) => ({
    count: ids.length,
    totalBytes: ids.length,
    missingCount: 0,
  })
  storage.saveAsset = async () => {
    saveAssetCalls += 1
    throw new Error('Notion 原子导入不得逐图写入')
  }
  storage.commitImport = async (snapshot, assets) => {
    attemptedCommits.push({
      tradeIds: snapshot.trades.map((trade) => trade.id),
      strategyIds: snapshot.strategies.map((strategy) => strategy.id),
      assets,
    })
    throw new Error(capacityError)
  }
  console.error = () => {}
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  try {
    enablePersistWrites()
    root.render(<NotionImportModal open onClose={() => {}} />)
    const input = await waitForFileInput()
    const zip = new JSZip()
    const imageLines: string[] = []
    for (let index = 0; index < 10; index += 1) {
      const name = `image-${index + 1}.png`
      const bytes = new Uint8Array([0, index, 255 - index, 17, 31])
      zip.file(name, bytes)
      imageLines.push(`![截图 ${index + 1}](${name})`)
    }
    zip.file('trade.md', [
      '# Trade #',
      'Date: 2026/07/14',
      'Symbol: BTCUSDT',
      'Model: 新策略',
      'Position: Buy',
      'Status: Closed by T/P',
      'Net PnL: US$20.00',
      '',
      ...imageLines,
    ].join('\n'))
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    const files = new DataTransfer()
    files.items.add(new File([zipBlob], 'notion.zip', { type: 'application/zip' }))
    Object.defineProperty(input, 'files', { configurable: true, value: files.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const importButton = await waitForEnabledButton('确认导入')
    importButton.click()
    await new Promise((resolve) => window.setTimeout(resolve, 100))

    assert(
      document.body.textContent?.includes(capacityError),
      'Notion 提交阶段的 96 MB 容量错误应原样提示用户',
    )
    assert(!document.body.textContent?.includes('正在导入'), '写盘失败后不得卡在 importing')
    assert(!document.body.textContent?.includes('已导入 1 笔交易'), '写盘失败不得进入完成状态')
    assert(!useToast.getState().message?.includes('已从 Notion 导入'), '写盘失败不得显示成功 toast')
    assert(unhandledRejections === 0, 'Notion 写盘失败不得产生未处理 Promise rejection')
    assert(
      useStore.getState().trades.map((trade) => trade.id).join(',') === 'existing-trade',
      'Notion 失败只应回滚本批交易，既有交易必须保留',
    )
    assert(
      useStore.getState().strategies.map((strategy) => strategy.id).join(',') === 'existing-strategy',
      'Notion 失败只应回滚本批新增策略，既有策略必须保留',
    )
    assert(saveAssetCalls === 0, 'Notion 图片不得在最终快照前逐张写盘')
    assert(
      attemptedCommits.length === 1,
      `完整快照与全部图片应只提交一次（实际 ${attemptedCommits.length} 次）`,
    )
    const attempted = attemptedCommits[0]
    assert(
      attempted?.tradeIds.some((id) => id !== 'existing-trade') &&
        attempted.strategyIds.some((id) => id !== 'existing-strategy'),
      '原子提交候选必须同时包含本批交易与策略',
    )
    assert(attempted?.assets.length === 10, '10 张图片必须作为同一个原子批次提交')
    attempted?.assets.forEach((asset, index) => {
      const decoded = Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0))
      assert(
        [...decoded].join(',') === [0, index, 255 - index, 17, 31].join(','),
        `第 ${index + 1} 张图片必须保持原始字节与 MIME`,
      )
      assert(asset.mime === 'image/png', `第 ${index + 1} 张图片 MIME 不得改变`)
    })
  } finally {
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    console.error = originalConsoleError
    disablePersistWrites()
    storage.saveSnapshot = originalSaveSnapshot
    storage.saveAsset = originalSaveAsset
    storage.commitImport = originalCommitImport
    storage.getAssetStats = originalGetAssetStats
    root.unmount()
  }
}

window.__notionImportPersistenceTest = run()
