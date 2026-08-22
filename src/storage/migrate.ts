import { SEED_TRADES } from '@/data/trades'
import { DEFAULT_STRATEGIES } from '@/data/strategies'
import {
  createDefaultUserProfile,
  createDefaultMistakeTagPresets,
  createDefaultTagPresets,
} from '@/config/defaultProfile'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import {
  migrateTrades,
} from '@/lib/strategies'
import { externalizeNoteImages, collectAssetIdsFromSnapshot } from '@/storage/assets'
import type { StorageAdapter } from '@/storage/adapter'
import type { PersistedSnapshot } from '@/storage/types'
import { LEGACY_LOCAL_STORAGE_KEY } from '@/storage/legacyIdentity'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'

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
    if (!raw) return null
    const parsed = JSON.parse(raw) as ZustandPersistEnvelope
    const s = parsed.state
    if (!s) return null
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
  } catch {
    return null
  }
}

function createSeedPersistedSnapshot(): PersistedSnapshot {
  const empty = createEmptyPersistedSnapshot()
  const trades = migrateTrades(SEED_TRADES, DEFAULT_STRATEGIES).map((trade) => {
    if (trade.tradeKind === 'paper') return trade
    return { ...trade, liveStageId: empty.currentLiveStageId }
  })
  return {
    ...empty,
    trades,
    strategies: [...DEFAULT_STRATEGIES],
    display: { ...DEFAULT_DISPLAY },
    tagPresets: createDefaultTagPresets(),
    mistakeTagPresets: createDefaultMistakeTagPresets(),
    symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
    profile: createDefaultUserProfile(),
  }
}

async function externalizeAllNotes(
  snapshot: PersistedSnapshot,
  adapter: StorageAdapter,
): Promise<PersistedSnapshot> {
  const trades = await Promise.all(
    snapshot.trades.map(async (t) => ({
      ...t,
      note: await externalizeNoteImages(t.note, adapter),
      ...(t.sourceNoteHtml === undefined
        ? {}
        : { sourceNoteHtml: await externalizeNoteImages(t.sourceNoteHtml, adapter) }),
    })),
  )
  const weeklyReviews = await Promise.all(
    (snapshot.weeklyReviews ?? []).map(async (review) => ({
      ...review,
      contentHtml: await externalizeNoteImages(review.contentHtml, adapter),
    })),
  )
  const quickNotes = await Promise.all(
    (snapshot.quickNotes ?? []).map(async (note) => ({
      ...note,
      contentHtml: await externalizeNoteImages(note.contentHtml, adapter),
    })),
  )
  return { ...snapshot, trades, weeklyReviews, quickNotes }
}

export async function migrateFromLocalStorageIfNeeded(
  adapter: StorageAdapter,
): Promise<boolean> {
  const existing = await adapter.loadSnapshot()
  if (existing) return false

  let snapshot = parseLegacyLocalStorage()
  if (!snapshot) {
    snapshot = createSeedPersistedSnapshot()
  }

  snapshot = await externalizeAllNotes(snapshot, adapter)
  await adapter.saveSnapshot(snapshot)

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
): Promise<boolean> {
  const existing = await adapter.loadSnapshot()
  if (existing) return false

  const idb = indexedDbAdapter
  await idb.open()
  await migrateFromLocalStorageIfNeeded(idb)

  let snapshot = await idb.loadSnapshot()
  // 零交易是有效资料库状态；只有快照真正缺失时才生成新库默认。
  if (!snapshot) {
    snapshot = createSeedPersistedSnapshot()
  }

  const assetIds = collectAssetIdsFromSnapshot(snapshot)
  const assets = []
  for (const id of assetIds) {
    const rec = await idb.getAssetForExport(id)
    if (rec) assets.push(rec)
  }
  if (assets.length > 0) {
    await adapter.importAssets(assets)
  }

  snapshot = await externalizeAllNotes(snapshot, adapter)
  await adapter.saveSnapshot(snapshot)
  return true
}

export async function externalizeSnapshotNotes(
  snapshot: PersistedSnapshot,
  adapter: StorageAdapter,
): Promise<PersistedSnapshot> {
  return externalizeAllNotes(snapshot, adapter)
}
