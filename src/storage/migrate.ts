import { SEED_TRADES } from '@/data/trades'
import { DEFAULT_STRATEGIES } from '@/data/strategies'
import {
  createDefaultUserProfile,
  createDefaultMistakeTagPresets,
  createDefaultTagPresets,
} from '@/config/defaultProfile'
import { DEFAULT_DISPLAY, normalizeDisplay } from '@/lib/tradeFilters'
import {
  migrateTrades,
  normalizeTradeStrategyReferences,
} from '@/lib/strategies'
import { normalizeTrades } from '@/lib/tradeKind'
import { externalizeNoteImages, collectAssetIdsFromNotes } from '@/storage/assets'
import type { StorageAdapter } from '@/storage/adapter'
import type { PersistedSnapshot } from '@/storage/types'
import { LEGACY_LOCAL_STORAGE_KEY } from '@/storage/types'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'

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
    const normalized = normalizeTradeStrategyReferences(s.trades ?? [], s.strategies)
    const trades = normalizeTrades(normalized.trades)
    return {
      trades,
      strategies: normalized.strategies,
      starredIds: s.starredIds ?? [],
      subscribedIds: s.subscribedIds ?? [],
      pinnedStrategyIds: s.pinnedStrategyIds ?? [],
      display: normalizeDisplay(s.display),
    }
  } catch {
    return null
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
    })),
  )
  return { ...snapshot, trades }
}

export async function migrateFromLocalStorageIfNeeded(
  adapter: StorageAdapter,
): Promise<boolean> {
  const existing = await adapter.loadSnapshot()
  if (existing) return false

  let snapshot = parseLegacyLocalStorage()
  if (!snapshot) {
    snapshot = {
      trades: migrateTrades(SEED_TRADES, DEFAULT_STRATEGIES),
      strategies: [...DEFAULT_STRATEGIES],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY },
      tagPresets: createDefaultTagPresets(),
      mistakeTagPresets: createDefaultMistakeTagPresets(),
      profile: createDefaultUserProfile(),
    }
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
    snapshot = {
      trades: migrateTrades(SEED_TRADES, DEFAULT_STRATEGIES),
      strategies: [...DEFAULT_STRATEGIES],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY },
      tagPresets: createDefaultTagPresets(),
      mistakeTagPresets: createDefaultMistakeTagPresets(),
      profile: createDefaultUserProfile(),
    }
  }

  const assetIds = collectAssetIdsFromNotes(snapshot.trades)
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
