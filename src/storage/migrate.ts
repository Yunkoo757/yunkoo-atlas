import { collectAssetIdsFromSnapshot } from '@/storage/snapshotRichText'
import { externalizeNoteImages, mayContainInlineImage } from '@/storage/assets'
import { tradeRichTextEntries } from '@/storage/tradeRichText'
import type { LibraryImportAsset, StorageAdapter } from '@/storage/adapter'
import { bytesToBase64 } from '@/lib/base64'
import type { PersistedSnapshot } from '@/storage/types'
import { LEGACY_LOCAL_STORAGE_KEY } from '@/storage/legacyIdentity'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { createNewLibrarySnapshot } from '@/storage/emptySnapshot'

interface ZustandPersistEnvelope {
  state?: {
    trades?: PersistedSnapshot['trades']
    strategies?: PersistedSnapshot['strategies']
    starredIds?: string[]
    subscribedIds?: string[]
    pinnedStrategyIds?: string[]
    display?: PersistedSnapshot['display']
  }
}

function parseLegacyLocalStorage(): PersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as ZustandPersistEnvelope
    const s = parsed.state
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      throw new Error('legacy state is missing or invalid')
    }
    return decodeCanonicalSnapshot(
      {
        trades: s.trades ?? [],
        strategies: s.strategies,
        starredIds: s.starredIds ?? [],
        subscribedIds: s.subscribedIds ?? [],
        pinnedStrategyIds: s.pinnedStrategyIds ?? [],
        display: s.display,
      },
      { version: 8, label: 'legacy localStorage snapshot' },
    )
  } catch (cause) {
    throw Object.assign(new Error('旧版交易资料无法解析或格式无效，已停止迁移并保留原始数据。'), { cause })
  }
}

/** 迁移返回前收齐本次附件写入。某条正文失败时，后续记录仍可从原快照重试。 */
export async function externalizeSnapshotNotes(
  snapshot: PersistedSnapshot,
  adapter: Pick<StorageAdapter, 'saveAsset'>,
  signal?: AbortSignal,
): Promise<PersistedSnapshot> {
  const convert = (html: string) => externalizeNoteImages(html, adapter, signal)
  const trades = snapshot.trades.slice()
  for (const [index, trade] of trades.entries()) {
    if (!tradeRichTextEntries(trade).some(mayContainInlineImage)) continue
    trades[index] = {
      ...trade,
      note: await convert(trade.note),
      ...(trade.sourceNoteHtml === undefined ? {} : { sourceNoteHtml: await convert(trade.sourceNoteHtml) }),
    }
  }

  async function convertDocuments<T extends { contentHtml: string }>(source: readonly T[] = []): Promise<T[]> {
    const documents = source.slice()
    for (const [index, record] of documents.entries()) {
      if (mayContainInlineImage(record.contentHtml)) {
        documents[index] = { ...record, contentHtml: await convert(record.contentHtml) }
      }
    }
    return documents
  }

  return {
    ...snapshot, trades,
    weeklyReviews: await convertDocuments(snapshot.weeklyReviews),
    quickNotes: await convertDocuments(snapshot.quickNotes),
  }
}

async function commitLegacySnapshot(
  adapter: StorageAdapter,
  snapshot: PersistedSnapshot,
  assets: LibraryImportAsset[],
  signal?: AbortSignal,
): Promise<void> {
  const candidate = await externalizeSnapshotNotes(snapshot, {
    async saveAsset(blob, mime) {
      const id = crypto.randomUUID()
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
      assets.push({ id, mime, data, inlineImage: true })
      return id
    },
  }, signal)
  signal?.throwIfAborted()
  await adapter.commitImport(candidate, assets)
}

export async function migrateFromLocalStorageIfNeeded(
  adapter: StorageAdapter,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const existing = await adapter.loadSnapshot()
  signal?.throwIfAborted()
  if (existing) return false

  const snapshot = parseLegacyLocalStorage() ?? createNewLibrarySnapshot()
  await commitLegacySnapshot(adapter, snapshot, [], signal)
  signal?.throwIfAborted()

  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
  } catch {
    /* ignore */
  }

  return true
}

/** Electron 首次启动：从 IndexedDB（或种子数据）迁入本地库文件夹 */
export async function migrateElectronLibraryIfNeeded(
  adapter: StorageAdapter,
  indexedDbAdapter: StorageAdapter = getIndexedDbAdapter(),
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const existing = await adapter.loadSnapshot()
  signal?.throwIfAborted()
  if (existing) return false

  const idb = indexedDbAdapter
  await idb.open()
  await migrateFromLocalStorageIfNeeded(idb, signal)

  let snapshot = await idb.loadSnapshot()
  // 零交易是有效资料库状态；只有快照真正缺失时才生成新库默认。
  if (!snapshot) {
    snapshot = createNewLibrarySnapshot()
  }

  const assetIds = collectAssetIdsFromSnapshot(snapshot)
  const assets: LibraryImportAsset[] = []
  for (const id of assetIds) {
    signal?.throwIfAborted()
    const rec = await idb.getAssetForExport(id)
    if (rec) assets.push(rec)
  }
  await commitLegacySnapshot(adapter, snapshot, assets, signal)
  return true
}
