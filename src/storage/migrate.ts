import { collectAssetIdsFromSnapshot } from '@/storage/snapshotRichText'
import { externalizeNoteImages } from '@/storage/assets'
import type { StorageAdapter } from '@/storage/adapter'
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

async function externalizeAllNotes(
  snapshot: PersistedSnapshot,
  adapter: StorageAdapter,
  signal?: AbortSignal,
): Promise<PersistedSnapshot> {
  const convert = (html: string) => externalizeNoteImages(html, adapter, signal)
  const trades = await Promise.all(
    snapshot.trades.map(async (t) => ({
      ...t,
      note: await convert(t.note),
      ...(t.sourceNoteHtml === undefined
        ? {}
        : { sourceNoteHtml: await convert(t.sourceNoteHtml) }),
    })),
  )
  const weeklyReviews = await Promise.all(
    (snapshot.weeklyReviews ?? []).map(async (review) => ({
      ...review,
      contentHtml: await convert(review.contentHtml),
    })),
  )
  const quickNotes = await Promise.all(
    (snapshot.quickNotes ?? []).map(async (note) => ({
      ...note,
      contentHtml: await convert(note.contentHtml),
    })),
  )
  return { ...snapshot, trades, weeklyReviews, quickNotes }
}

export async function migrateFromLocalStorageIfNeeded(
  adapter: StorageAdapter,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const existing = await adapter.loadSnapshot()
  signal?.throwIfAborted()
  if (existing) return false

  let snapshot = parseLegacyLocalStorage()
  if (!snapshot) {
    snapshot = createNewLibrarySnapshot()
  }

  snapshot = await externalizeAllNotes(snapshot, adapter, signal)
  signal?.throwIfAborted()
  await adapter.saveSnapshot(snapshot)
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
  const assets = []
  for (const id of assetIds) {
    signal?.throwIfAborted()
    const rec = await idb.getAssetForExport(id)
    if (rec) assets.push(rec)
  }
  if (assets.length > 0) {
    signal?.throwIfAborted()
    await adapter.importAssets(assets)
  }

  snapshot = await externalizeAllNotes(snapshot, adapter, signal)
  signal?.throwIfAborted()
  await adapter.saveSnapshot(snapshot)
  return true
}

export async function externalizeSnapshotNotes(
  snapshot: PersistedSnapshot,
  adapter: StorageAdapter,
): Promise<PersistedSnapshot> {
  return externalizeAllNotes(snapshot, adapter)
}
