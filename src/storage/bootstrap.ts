import type { StorageAdapter } from '@/storage/adapter'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import {
  migrateElectronLibraryIfNeeded,
  migrateFromLocalStorageIfNeeded,
} from '@/storage/migrate'
import { pickPersisted, schedulePersist } from '@/storage/persist'
import { useShortcutStore } from '@/store/shortcutStore'
import { isElectron } from '@/storage/runtime'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeSymbolIcons, normalizeSymbolCatalog } from '@/lib/symbolIcons'
import {
  collectAllMistakeTags,
  collectAllTags,
  mergeTagPresets,
} from '@/lib/tags'

let storage: StorageAdapter | null = null
let hydrated = false

export function getStorage(): StorageAdapter {
  if (!storage) {
    storage = isElectron() ? getElectronAdapter() : getIndexedDbAdapter()
  }
  return storage
}

export function isStorageHydrated(): boolean {
  return hydrated
}

export async function bootstrapStorage(): Promise<void> {
  const adapter = getStorage()
  await adapter.open()

  if (isElectron()) {
    await migrateElectronLibraryIfNeeded(adapter)
  } else {
    await migrateFromLocalStorageIfNeeded(adapter)
  }

  const snapshot = await adapter.loadSnapshot()
  if (snapshot) {
    const trades = normalizeTrades(snapshot.trades)
    useStore.setState({
      trades,
      strategies: snapshot.strategies,
      starredIds: snapshot.starredIds,
      subscribedIds: snapshot.subscribedIds,
      pinnedStrategyIds: snapshot.pinnedStrategyIds,
      display: normalizeDisplay(snapshot.display),
      tagPresets: mergeTagPresets(snapshot.tagPresets ?? [], collectAllTags(trades)),
      mistakeTagPresets: mergeTagPresets(
        snapshot.mistakeTagPresets ?? [],
        collectAllMistakeTags(trades),
      ),
      savedTradeViews: normalizeSavedTradeViews(snapshot.savedTradeViews),
      symbolIcons: normalizeSymbolIcons(snapshot.symbolIcons),
      symbolCatalog: normalizeSymbolCatalog(
        snapshot.symbolCatalog ?? [
          ...Object.keys(normalizeSymbolIcons(snapshot.symbolIcons)),
          ...trades.map((trade) => trade.symbol),
        ],
      ),
    })
    useStore.getState().hydrateProfile(snapshot.profile)
    useShortcutStore.getState().hydrateBindings(snapshot.shortcuts)
  }

  hydrated = true
  useSaveStatus.getState().setSaved()

  useStore.subscribe((state) => {
    if (!hydrated) return
    schedulePersist(pickPersisted(state, useShortcutStore.getState().bindings))
  })

  useShortcutStore.subscribe((state, prev) => {
    if (!hydrated) return
    if (state.bindings === prev.bindings) return
    schedulePersist(pickPersisted(useStore.getState(), state.bindings))
  })
}
