import type { Strategy } from '@/data/strategies'
import { createQuickNote } from '@/data/quickNotes'
import { createReviewTemplate } from '@/data/reviewTemplates'
import { createWeeklyReview } from '@/data/weeklyReviews'
import type { NotionTradePreview } from '@/lib/notionImport'
import {
  commitNotionImportBatch,
  MAX_NOTION_IMAGE_BYTES,
  MAX_NOTION_IMPORT_IMAGE_BYTES,
  prepareNotionAssetsForCommit,
} from '@/lib/notionImportCommit'
import { getStorage } from '@/storage'
import type { StorageAdapter } from '@/storage/adapter'
import {
  disablePersistWrites,
  enablePersistWrites,
  getPersistSuspendDepth,
} from '@/storage/persist'
import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import type {
  ExportAssetRecord,
  LibraryManifest,
  PersistedSnapshot,
} from '@/storage/types'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function previewWithImages(count: number): NotionTradePreview {
  return {
    trade: {
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'win',
      conviction: 'medium',
      strategyId: 'strategy-1',
      openedAt: '2026-07-14',
      tags: [],
      mistakeTags: [],
    },
    collectedTags: [],
    mistakeTags: [],
    noteHtml: Array.from(
      { length: count },
      (_, index) => `<img data-notion-img="${index}" alt="截图 ${index + 1}" />`,
    ).join('\n'),
    images: Array.from({ length: count }, (_, index) => ({
      zipPath: `trade/image-${index}.png`,
      name: `image-${index}.png`,
      data: new Uint8Array([0, index, 255 - index, 17, 31]),
      mime: 'image/png',
      size: 5,
    })),
    imageCount: count,
    errors: [],
    warnings: [],
    rowIndex: 1,
  }
}

function snapshot(label: string): PersistedSnapshot {
  return {
    trades: [],
    strategies: [{
      id: 'strategy-1',
      name: label,
      icon: 'target',
      color: '#5e6ad2',
    }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class AtomicMemoryAdapter implements StorageAdapter {
  committedSnapshot: PersistedSnapshot
  committedAssets: ExportAssetRecord[] = []
  commitCalls = 0
  failCommit = false
  onCommitWait: (() => Promise<void>) | null = null

  constructor(initial: PersistedSnapshot) {
    this.committedSnapshot = initial
  }

  async open(): Promise<void> {}
  async getManifest(): Promise<LibraryManifest> {
    return { schemaVersion: 6, libraryId: 'test', createdAt: '2026-07-14' }
  }
  async loadSnapshot(): Promise<PersistedSnapshot> { return this.committedSnapshot }
  async saveSnapshot(value: PersistedSnapshot): Promise<void> { this.committedSnapshot = value }
  async saveAsset(): Promise<string> { throw new Error('原子导入不得逐图写入') }
  async getAssetObjectUrl(): Promise<string | null> { return null }
  async getAssetForExport(): Promise<ExportAssetRecord | null> { return null }
  async getAssetStats(): Promise<{ count: number; totalBytes: number; missingCount: number }> {
    return { count: 0, totalBytes: 0, missingCount: 0 }
  }
  async importAssets(): Promise<void> { throw new Error('原子导入不得分离写附件') }
  async commitImport(value: PersistedSnapshot, assets: ExportAssetRecord[]): Promise<void> {
    this.commitCalls += 1
    if (this.onCommitWait) await this.onCommitWait()
    if (this.failCommit) throw new Error('simulated atomic commit failure')
    this.committedSnapshot = value
    this.committedAssets = assets
  }
}

function seedStore(): { strategies: Strategy[]; tradeIds: string[] } {
  const strategies: Strategy[] = [{
    id: 'strategy-1',
    name: '既有策略',
    icon: 'target',
    color: '#5e6ad2',
  }]
  useStore.setState({ trades: [], strategies })
  return { strategies, tradeIds: [] }
}

export function testNotionAssetPreparationKeepsAllOriginalBytesLosslessly(): void {
  const prepared = prepareNotionAssetsForCommit(
    [previewWithImages(10)],
    (() => {
      let index = 0
      return () => `notion-asset-${++index}`
    })(),
  )

  assert(prepared.assets.length === 10, '10 张原图必须完整进入同一提交批次')
  prepared.assets.forEach((asset, index) => {
    const decoded = Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0))
    assert(
      [...decoded].join(',') === [0, index, 255 - index, 17, 31].join(','),
      `第 ${index + 1} 张图片的原始字节不得改变`,
    )
  })
}

export function testNotionImageLimitsRejectBeforeBase64AllocationOrCommit(): void {
  const oversized = previewWithImages(1)
  oversized.images[0]!.data = { byteLength: MAX_NOTION_IMAGE_BYTES + 1 } as Uint8Array
  let singleError = ''
  try {
    prepareNotionAssetsForCommit([oversized])
  } catch (error) {
    singleError = error instanceof Error ? error.message : String(error)
  }
  assert(singleError.includes('32 MB'), '超大单图必须在 Base64 分配前明确拒绝')

  const total = previewWithImages(4)
  total.images.forEach((image) => {
    image.data = { byteLength: Math.floor(MAX_NOTION_IMPORT_IMAGE_BYTES / 4) + 1 } as Uint8Array
  })
  let totalError = ''
  try {
    prepareNotionAssetsForCommit([total])
  } catch (error) {
    totalError = error instanceof Error ? error.message : String(error)
  }
  assert(totalError.includes('96 MB'), '超大批次必须在任何图片编码前要求分批导入')
}

export async function testNotionTenImagePreparationFailureDoesNotCommitAnyPartialBatch(): Promise<void> {
  disablePersistWrites()
  const seeded = seedStore()
  const adapter = new AtomicMemoryAdapter(snapshot('旧快照'))
  let generated = 0
  let rejected = false

  try {
    await commitNotionImportBatch([previewWithImages(10)], {
      storage: adapter,
      createAssetId: () => {
        generated += 1
        if (generated === 6) throw new Error('simulated image preparation failure')
        return `asset-${generated}`
      },
    })
  } catch {
    rejected = true
  }

  assert(rejected, '第 6 张图片准备失败必须拒绝整批导入')
  assert(adapter.commitCalls === 0, '图片尚未全部准备完成时不得调用原子提交')
  assert(adapter.committedAssets.length === 0, '准备失败不得留下前 5 张孤儿附件')
  assert(adapter.committedSnapshot.strategies[0]?.name === '旧快照', '准备失败不得覆盖原快照')
  assert(useStore.getState().trades.map((trade) => trade.id).join(',') === seeded.tradeIds.join(','), '准备失败不得发布交易到 store')
  assert(useStore.getState().strategies === seeded.strategies, '准备失败不得发布策略到 store')
  assert(getPersistSuspendDepth() === 0, '准备失败后必须恢复自动保存')
}

export async function testNotionAtomicCommitFailureLeavesStoreSnapshotAndAssetsUntouched(): Promise<void> {
  disablePersistWrites()
  const seeded = seedStore()
  const adapter = new AtomicMemoryAdapter(snapshot('旧快照'))
  adapter.failCommit = true
  let rejected = false

  try {
    await commitNotionImportBatch([previewWithImages(10)], {
      storage: adapter,
      createAssetId: (() => {
        let index = 0
        return () => `asset-${++index}`
      })(),
    })
  } catch {
    rejected = true
  }

  assert(rejected, '原子提交失败必须向调用方报告失败')
  assert(adapter.commitCalls === 1, '完整批次只应提交一次')
  assert(adapter.committedAssets.length === 0, '提交失败不得留下任何孤儿附件')
  assert(adapter.committedSnapshot.strategies[0]?.name === '旧快照', '提交失败不得覆盖原快照')
  assert(useStore.getState().trades.map((trade) => trade.id).join(',') === seeded.tradeIds.join(','), '提交失败不得发布交易到 store')
  assert(useStore.getState().strategies === seeded.strategies, '提交失败不得发布策略到 store')
  assert(getPersistSuspendDepth() === 0, '提交失败后必须恢复自动保存')
}

export async function testNotionSuccessPublishesOnlyTheAtomicallyCommittedBatch(): Promise<void> {
  disablePersistWrites()
  seedStore()
  const adapter = new AtomicMemoryAdapter(snapshot('旧快照'))

  const result = await commitNotionImportBatch([previewWithImages(10)], {
    storage: adapter,
    createAssetId: (() => {
      let index = 0
      return () => `asset-${++index}`
    })(),
  })

  assert(adapter.commitCalls === 1, '成功路径只应执行一次原子提交')
  assert(adapter.committedAssets.length === 10, '成功路径必须提交全部 10 张图片')
  assert(adapter.committedSnapshot.trades.length === 1, '最终快照必须包含导入交易')
  const note = adapter.committedSnapshot.trades[0]?.note ?? ''
  for (let index = 1; index <= 10; index += 1) {
    assert(note.includes(`journal-asset://asset-${index}`), `最终笔记必须引用第 ${index} 张附件`)
  }
  assert(
    useStore.getState().trades[0] === adapter.committedSnapshot.trades[0],
    'store 只能发布与原子快照相同的交易对象',
  )
  assert(result.imageCount === 10 && result.importedTrades.length === 1, '成功结果计数必须准确')
  assert(getPersistSuspendDepth() === 0, '成功提交后必须恢复自动保存')
}

export function testNotionImportRevisionKeysMatchSharedPersistedKeys(): void {
  assert(
    PERSISTED_STATE_REFERENCE_KEYS.includes('quickNotes')
      && PERSISTED_STATE_REFERENCE_KEYS.includes('weeklyReviews')
      && PERSISTED_STATE_REFERENCE_KEYS.includes('reviewTemplates'),
    'Notion revision 必须覆盖随记、周复盘与复盘模板，避免并发编辑被误判为同版本',
  )
}

export async function testNotionImportPreservesConcurrentQuickNotesWeeklyReviewsAndTemplates(): Promise<void> {
  const commitStarted = deferred()
  const allowCommit = deferred()
  const adapter = new AtomicMemoryAdapter(snapshot('旧快照'))
  adapter.onCommitWait = async () => {
    commitStarted.resolve()
    await allowCommit.promise
  }

  const concurrentNote = { ...createQuickNote(new Date('2026-07-14T12:00:00.000Z')), title: '提交期间随记' }
  const concurrentReview = {
    ...createWeeklyReview('2026-07-13', new Date('2026-07-14T12:00:00.000Z')),
    contentHtml: '<p>提交期间周复盘</p>',
  }
  const concurrentTemplate = createReviewTemplate('提交期间模板')
  concurrentTemplate.content = '并发模板正文'

  seedStore()
  useStore.setState({
    quickNotes: [],
    weeklyReviews: [],
    reviewTemplates: [],
  })

  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const trailingSaves: PersistedSnapshot[] = []
  storage.saveSnapshot = async (value) => {
    trailingSaves.push(value)
    adapter.committedSnapshot = value
  }

  enablePersistWrites()
  try {
    const importing = commitNotionImportBatch([previewWithImages(1)], {
      storage: adapter,
      createAssetId: (() => {
        let index = 0
        return () => `asset-${++index}`
      })(),
    })

    await commitStarted.promise
    useStore.setState({
      quickNotes: [concurrentNote],
      weeklyReviews: [concurrentReview],
      reviewTemplates: [concurrentTemplate],
    })
    allowCommit.resolve()
    const result = await importing

    const finalState = useStore.getState()
    assert(finalState.trades.length === 1, '导入交易必须进入 store')
    assert(finalState.quickNotes[0]?.title === '提交期间随记', '等待 commitImport 期间新增的随记不得丢失')
    assert(
      finalState.weeklyReviews[0]?.contentHtml === '<p>提交期间周复盘</p>',
      '等待 commitImport 期间新增的周复盘不得丢失',
    )
    assert(
      finalState.reviewTemplates[0]?.name === '提交期间模板',
      '等待 commitImport 期间新增的复盘模板不得丢失',
    )
    assert(result.trailingSaveFailed === false, '并发字段变化后追写不得失败')
    assert(trailingSaves.length >= 1, '检测到并发编辑后必须追写落盘，不得 discardPending')

    const disk = adapter.committedSnapshot
    assert(disk.quickNotes?.[0]?.title === '提交期间随记', '磁盘快照必须与内存随记一致')
    assert(
      disk.weeklyReviews?.[0]?.contentHtml === '<p>提交期间周复盘</p>',
      '磁盘快照必须与内存周复盘一致',
    )
    assert(
      disk.reviewTemplates?.[0]?.name === '提交期间模板',
      '磁盘快照必须与内存复盘模板一致',
    )
    assert(disk.trades.length === 1, '追写后的磁盘快照仍须保留导入交易')
    assert(getPersistSuspendDepth() === 0, '并发路径结束后必须恢复自动保存')
  } finally {
    disablePersistWrites()
    storage.saveSnapshot = originalSaveSnapshot
  }
}
