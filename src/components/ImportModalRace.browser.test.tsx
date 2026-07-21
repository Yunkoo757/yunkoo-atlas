import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import type { Trade } from '@/data/trades'
import { getStorage } from '@/storage'
import { useStore } from '@/store/useStore'
import { CsvImportModal } from './CsvImportModal'
import {
  getNotionCapacityErrorMessage,
  MAX_NOTION_CSV_FILE_BYTES,
  MAX_NOTION_ZIP_FILE_BYTES,
  NotionImportModal,
} from './NotionImportModal'

declare global {
  interface Window {
    __importModalRaceTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function settleFrames(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) await waitForFrame()
}

function liveModalRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.modal-shell-overlay:not(.ui-exit-clone)')
}

async function waitForButton(text: string): Promise<HTMLButtonElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const root = liveModalRoot()
    const button = root
      ? [...root.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) => item.textContent?.includes(text))
      : undefined
    if (button) return button
    await waitForFrame()
  }
  throw new Error(`未找到按钮：${text}`)
}

async function waitForEnabledButton(text: string): Promise<HTMLButtonElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const root = liveModalRoot()
    const button = root
      ? [...root.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) => item.textContent?.includes(text) && !item.disabled)
      : undefined
    if (button) return button
    await waitForFrame()
  }
  throw new Error(`未找到可用按钮：${text}`)
}

async function waitForFileInput(): Promise<HTMLInputElement> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    const input = liveModalRoot()?.querySelector<HTMLInputElement>('input[type="file"]')
    if (input) return input
    await waitForFrame()
  }
  throw new Error('导入弹窗应提供文件输入')
}

async function waitForText(text: string): Promise<void> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    if (liveModalRoot()?.textContent?.includes(text)) return
    await waitForFrame()
  }
  throw new Error(`未找到文本：${text}`)
}

function dispatchFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function delayedTextFile(name: string, pendingText: Promise<string>): File {
  const file = new File([], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: () => pendingText,
  })
  return file
}

function withReportedSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function notionCsv(symbol: string): string {
  return [
    'Date,Symbol,Position,Status,Net PnL',
    `2026/07/14,${symbol},Buy,Closed by T/P,US$20.00`,
  ].join('\n')
}

async function notionZip(symbol: string, includeImage: boolean): Promise<File> {
  const zip = new JSZip()
  const body = [
    '# Trade #',
    'Date: 2026/07/14',
    `Symbol: ${symbol}`,
    'Position: Buy',
    'Status: Closed by T/P',
    ...(includeImage ? ['', '![截图](shot.png)'] : []),
  ].join('\n')
  zip.file('trade.md', body)
  if (includeImage) zip.file('shot.png', new Uint8Array([0, 1, 2, 3]))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return new File([blob], `${symbol}.zip`, { type: 'application/zip' })
}

function existingTrade(): Trade {
  return {
    id: 'existing-trade',
    ref: 'TRD-1',
    symbol: 'EURUSD',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: 'strategy-test',
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
    note: '<img src="journal-asset://slow-asset">',
  }
}

function resetStore(): void {
  useStore.setState({
    trades: [existingTrade()],
    strategies: [{ id: 'strategy-test', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
  })
}

async function testCsvRace(host: HTMLElement): Promise<void> {
  resetStore()
  const storage = getStorage()
  const originalGetAsset = storage.getAssetForExport.bind(storage)
  let assetLoaderCalls = 0
  let closeCalls = 0
  storage.getAssetForExport = async () => {
    assetLoaderCalls += 1
    return { id: 'slow-asset', mime: 'image/png', data: 'AA==' }
  }
  const root = createRoot(host)

  try {
    root.render(<CsvImportModal open onClose={() => { closeCalls += 1 }} />)
    const input = await waitForFileInput()
    const oldParse = deferred<string>()
    dispatchFile(input, delayedTextFile('old.csv', oldParse.promise))
    dispatchFile(input, new File([
      'new_symbol,side,status,strategy,entry,size,openedAt\nNEWUSDT,long,open,测试策略,100,1,2026-07-14',
    ], 'new.csv', { type: 'text/csv' }))

    await waitForText('new_symbol')
    oldParse.resolve(
      'old_symbol,side,status,strategy,entry,size,openedAt\nOLDUSDT,long,open,测试策略,100,1,2026-07-14',
    )
    await settleFrames()
    assert(document.body.textContent?.includes('new_symbol'), 'CSV 较慢旧文件不得覆盖较新的字段映射')
    assert(!document.body.textContent?.includes('old_symbol'), 'CSV 旧解析结果必须被丢弃')

    const previewButton = await waitForButton('预览导入')
    previewButton.click()
    const confirmButton = await waitForButton('确认导入')
    assert(!confirmButton.disabled, 'CSV 正文索引完成后应开放确认导入')
    assert(assetLoaderCalls === 0, 'CSV 正文判重不得读取库内附件')

    const backButton = await waitForButton('返回调整映射')
    backButton.click()
    await settleFrames()
    assert(document.body.textContent?.includes('new_symbol'), 'CSV 返回后应恢复当前文件的字段映射')
    assert(!document.body.textContent?.includes('确认导入'), 'CSV 返回后不得保留预览步骤')

    const reselectButton = await waitForButton('重新选择文件')
    reselectButton.click()
    const nextInput = await waitForFileInput()
    const closedParse = deferred<string>()
    dispatchFile(nextInput, delayedTextFile('closed.csv', closedParse.promise))
    liveModalRoot()?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    )
    closedParse.resolve(
      'closed_symbol,side,status,strategy,entry,size,openedAt\nCLOSEUSDT,long,open,测试策略,100,1,2026-07-14',
    )
    await settleFrames()
    assert(closeCalls === 1, 'CSV 关闭操作应正常上报')
    assert(!document.body.textContent?.includes('closed_symbol'), 'CSV 关闭后未完成的解析不得再更新界面')
  } finally {
    storage.getAssetForExport = originalGetAsset
    root.unmount()
  }
}

async function testNotionRace(host: HTMLElement): Promise<void> {
  resetStore()
  const storage = getStorage()
  const originalGetAsset = storage.getAssetForExport.bind(storage)
  const originalGetAssetStats = storage.getAssetStats.bind(storage)
  let assetLoaderCalls = 0
  let closeCalls = 0
  storage.getAssetForExport = async () => {
    assetLoaderCalls += 1
    return { id: 'slow-asset', mime: 'image/png', data: 'AA==' }
  }
  storage.getAssetStats = async (ids) => ({
    count: ids.length,
    totalBytes: ids.length,
    missingCount: 0,
  })
  const root = createRoot(host)

  try {
    root.render(<NotionImportModal open onClose={() => { closeCalls += 1 }} />)
    const input = await waitForFileInput()

    let oversizedZipReads = 0
    const oversizedZip = withReportedSize(
      new File([], 'oversized.zip', { type: 'application/zip' }),
      MAX_NOTION_ZIP_FILE_BYTES + 1,
    )
    Object.defineProperty(oversizedZip, 'arrayBuffer', {
      configurable: true,
      value: async () => {
        oversizedZipReads += 1
        return new ArrayBuffer(0)
      },
    })
    dispatchFile(input, oversizedZip)
    await waitForText('Notion ZIP 文件超过 160 MB，请拆分后导入')
    assert(oversizedZipReads === 0, '超限 ZIP 必须在调用 arrayBuffer 前拒绝')

    let oversizedCsvReads = 0
    const oversizedCsv = withReportedSize(
      new File([], 'oversized.csv', { type: 'text/csv' }),
      MAX_NOTION_CSV_FILE_BYTES + 1,
    )
    Object.defineProperty(oversizedCsv, 'text', {
      configurable: true,
      value: async () => {
        oversizedCsvReads += 1
        return ''
      },
    })
    dispatchFile(input, oversizedCsv)
    await waitForText('Notion CSV 文件超过 32 MB，请拆分后导入')
    assert(oversizedCsvReads === 0, '超限 CSV 必须在调用 text 前拒绝')

    const imageCapacityError =
      '单张原图超过 32 MB，请移除该附件后重试；为保留画质，软件不会自动压缩原图'
    const expandedCapacityError = 'Notion 导出解压后超过 160 MB，请拆分后导入'
    dispatchFile(
      input,
      delayedTextFile('capacity.csv', Promise.reject(new Error(imageCapacityError))),
    )
    await waitForText(imageCapacityError)
    const parserZip = new File([], 'capacity.zip', { type: 'application/zip' })
    Object.defineProperty(parserZip, 'arrayBuffer', {
      configurable: true,
      value: async () => { throw new Error(expandedCapacityError) },
    })
    dispatchFile(input, parserZip)
    await waitForText(expandedCapacityError)
    assert(
      getNotionCapacityErrorMessage(new Error(
        '本次原图总量超过 96 MB，请分批导入；为保留画质，软件不会自动压缩原图',
      ))?.includes('96 MB'),
      '96 MB 容量错误必须在白名单内',
    )
    assert(
      getNotionCapacityErrorMessage(new Error('内部路径与实现细节')) === null,
      '非白名单错误不得直接暴露',
    )

    const slowParse = deferred<string>()
    let secondParseReads = 0
    dispatchFile(input, delayedTextFile('slow.csv', slowParse.promise))
    await waitForText('正在解析…')
    assert(input.disabled, '解析期间必须禁用文件输入')
    const ignoredFile = new File([], 'ignored.csv', { type: 'text/csv' })
    Object.defineProperty(ignoredFile, 'text', {
      configurable: true,
      value: async () => {
        secondParseReads += 1
        return notionCsv('IGNORED')
      },
    })
    dispatchFile(input, ignoredFile)
    await settleFrames()
    assert(secondParseReads === 0, '已有解析运行时不得启动第二次文件读取')
    liveModalRoot()?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    )
    slowParse.resolve(notionCsv('CLOSED'))
    await waitForEnabledButton('选择文件')
    await settleFrames()
    assert(closeCalls === 1, 'Notion 关闭操作应正常上报')
    assert(!document.body.textContent?.includes('CLOSED'), 'Notion 关闭后未完成的解析不得再更新界面')

    const noImageInput = await waitForFileInput()
    dispatchFile(
      noImageInput,
      new File([notionCsv('CSVNOIMAGE')], 'no-image.csv', { type: 'text/csv' }),
    )
    await waitForText('CSVNOIMAGE')
    await waitForEnabledButton('确认导入')
    assert(assetLoaderCalls === 0, '无图 Notion CSV 判重不得读取库内附件')
    ;(await waitForButton('重新选择文件')).click()

    const noImageZipInput = await waitForFileInput()
    dispatchFile(noImageZipInput, await notionZip('ZIPNOIMAGE', false))
    await waitForText('ZIPNOIMAGE')
    await waitForEnabledButton('确认导入')
    assert(assetLoaderCalls === 0, '无图 Notion ZIP 判重不得读取库内附件')
    ;(await waitForButton('重新选择文件')).click()

    const scan = deferred<{ id: string; mime: string; data: string } | null>()
    storage.getAssetForExport = async () => {
      assetLoaderCalls += 1
      return scan.promise
    }
    const imageZipInput = await waitForFileInput()
    dispatchFile(imageZipInput, await notionZip('ZIPWITHIMAGE', true))
    await waitForText('ZIPWITHIMAGE')
    const confirmButton = await waitForButton('确认导入')
    assert(confirmButton.disabled, '含图 Notion 重复扫描完成前必须禁用确认导入')
    assert(Number(assetLoaderCalls) === 1, '含图 Notion 判重仍应读取库内附件')
    ;(await waitForButton('重新选择文件')).click()
    scan.resolve({ id: 'slow-asset', mime: 'image/png', data: 'AA==' })
    await settleFrames()
    assert(document.body.textContent?.includes('拖放或选择文件'), '重选后旧图片扫描不得恢复预览')
  } finally {
    storage.getAssetForExport = originalGetAsset
    storage.getAssetStats = originalGetAssetStats
    root.unmount()
  }
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const csvHost = document.createElement('div')
  rootElement.appendChild(csvHost)
  await testCsvRace(csvHost)
  csvHost.remove()

  const notionHost = document.createElement('div')
  rootElement.appendChild(notionHost)
  await testNotionRace(notionHost)
  notionHost.remove()
}

window.__importModalRaceTest = run()
