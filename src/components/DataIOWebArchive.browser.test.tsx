import JSZip from 'jszip'
import { createRoot } from 'react-dom/client'
import { DataIOContent } from '@/components/DataIOContent'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { parseWebJournalArchive, WEB_JOURNAL_EXPORT_VERSION } from '@/lib/webJournalArchive'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  loadReviewSession,
  saveReviewSession,
} from '@/lib/reviewSession'
import { flushPersistNow } from '@/storage/persist'
import { bootstrapStorage } from '@/storage'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'
import { MAX_JSON_FILE_BYTES } from '@/lib/importLimits'
import { useToast } from '@/lib/toast'

declare global {
  interface Window {
    __dataIOWebArchiveRestoreTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

function trade(id: string, note = ''): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-16',
    closedAt: null,
    note,
  }
}

async function archiveFile(snapshot: PersistedSnapshot, assetId: string): Promise<File> {
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify({
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    ...snapshot,
    assets: [{ id: assetId, mime: 'image/png' }],
  }))
  zip.file(`assets/${assetId}.png`, new TextEncoder().encode('restored-image'))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return new File([blob], 'restore.journal.zip', { type: 'application/zip' })
}

async function desktopArchiveFile(): Promise<File> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    libraryId: 'desktop-contract',
    createdAt: '2026-07-18T08:00:00.000Z',
    platform: 'electron',
  }))
  zip.file('journal.db', new Uint8Array([1, 2, 3, 4]))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return new File([blob], 'desktop-exact.journal.zip', { type: 'application/zip' })
}

async function run(): Promise<void> {
  await bootstrapStorage()
  const adapter = getIndexedDbAdapter()
  const manifest = await adapter.getManifest()
  saveReviewSession(manifest.libraryId, {
    ids: ['old'],
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    assessments: { old: 'recheck' },
  })
  const oldAssetId = await adapter.saveAsset(
    new Blob(['old-image'], { type: 'image/png' }),
    'image/png',
  )
  useStore.setState({
    trades: [trade('old', `<img src="journal-asset://${oldAssetId}">`)],
    strategies: [{ id: 'strategy-1', name: '旧策略', icon: 'target', color: '#5e6ad2' }],
  })
  useStore.getState().hydrateProfile({ avatarId: null, displayName: '旧资料' })
  await flushPersistNow()

  const restoredAssetId = 'restored-archive-asset'
  const restoredSnapshot: PersistedSnapshot = {
    trades: [trade('restored', `<p>恢复内容</p><img src="journal-asset://${restoredAssetId}">`)],
    strategies: [{ id: 'strategy-1', name: '恢复策略', icon: 'target', color: '#5e6ad2' }],
    starredIds: ['restored'],
    subscribedIds: [],
    pinnedStrategyIds: ['strategy-1'],
    display: { ...DEFAULT_DISPLAY },
    shortcuts: { 'global.newTrade': { key: 'n' } },
    tagPresets: ['恢复标签'],
    mistakeTagPresets: ['恢复错误'],
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: ['BTCUSDT'],
    profile: { avatarId: null, displayName: '恢复资料' },
  }

  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<DataIOContent />)

  try {
    await waitFor(
      () => Boolean(document.querySelector<HTMLInputElement>('input[accept*="journal.zip"]')),
      '浏览器完整恢复文件入口未出现',
    )
    const jsonInput = document.querySelector<HTMLInputElement>('input[accept*="application/json"]')
    assert(jsonInput, 'JSON 恢复文件入口未出现')
    let oversizedTextReads = 0
    const oversizedJson = new File(['{}'], 'oversized.json', { type: 'application/json' })
    Object.defineProperties(oversizedJson, {
      size: { configurable: true, value: MAX_JSON_FILE_BYTES + 1 },
      text: {
        configurable: true,
        value: async () => {
          oversizedTextReads += 1
          return '{}'
        },
      },
    })
    Object.defineProperty(jsonInput, 'files', { configurable: true, value: [oversizedJson] })
    jsonInput.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(
      () => useToast.getState().message?.includes('JSON 备份超过 64 MiB') === true,
      '超限 JSON 必须在真实文件入口显示稳定容量错误',
    )
    assert(oversizedTextReads === 0, '真实 JSON 文件入口必须在调用 file.text() 前拒绝超限输入')

    const input = document.querySelector<HTMLInputElement>('input[accept*="journal.zip"]')!
    const transfer = new DataTransfer()
    transfer.items.add(await archiveFile(restoredSnapshot, restoredAssetId))
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(
      () => document.querySelector('[role="dialog"]')?.textContent?.includes('恢复完整交易库') === true,
      '归档校验成功后必须显示影响预览',
    )
    assert(document.body.textContent?.includes('恢复资料'), '影响预览必须展示归档资料身份')
    assert(document.body.textContent?.includes('1'), '影响预览必须展示记录和附件数量')

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '替换当前交易库')
    assert(confirm, '缺少明确的整库替换确认操作')
    confirm.click()

    await waitFor(
      () => useStore.getState().trades[0]?.id === 'restored',
      '确认后必须切换到归档快照',
    )
    await waitFor(
      () => !document.querySelector('[role="dialog"]'),
      '恢复成功后确认弹层必须关闭',
    )
    assert(useStore.getState().profile.displayName === '恢复资料', '完整恢复必须包含个人资料')
    assert(loadReviewSession(manifest.libraryId) === null, '整库恢复必须清除同一资料库的旧随机复盘队列')
    assert(await adapter.getAssetForExport(restoredAssetId), '完整恢复必须写入新附件')
    assert((await adapter.getAssetForExport(oldAssetId)) === null, '完整恢复必须清除旧附件')

    const snapshotBeforeDesktopReject = JSON.stringify(await adapter.loadSnapshot())
    const assetBeforeDesktopReject = await adapter.getAssetForExport(restoredAssetId)
    const storeTradeBeforeDesktopReject = useStore.getState().trades[0]?.id
    let desktopRejectMessage = ''
    try {
      await parseWebJournalArchive(await desktopArchiveFile())
    } catch (error) {
      desktopRejectMessage = error instanceof Error ? error.message : String(error)
    }
    assert(
      desktopRejectMessage.includes('桌面版完整交易库归档'),
      'Electron exact ZIP 必须在 Web 恢复边界返回稳定的 desktop-format 文案',
    )
    assert(
      JSON.stringify(await adapter.loadSnapshot()) === snapshotBeforeDesktopReject,
      'desktop-format 拒绝后 IndexedDB 快照必须零变化',
    )
    assert(
      JSON.stringify(await adapter.getAssetForExport(restoredAssetId)) ===
        JSON.stringify(assetBeforeDesktopReject),
      'desktop-format 拒绝后 IndexedDB 附件必须零变化',
    )
    assert(
      useStore.getState().trades[0]?.id === storeTradeBeforeDesktopReject,
      'desktop-format 拒绝后 Store 必须零变化',
    )
  } finally {
    root.unmount()
  }
}

window.__dataIOWebArchiveRestoreTest = run()
