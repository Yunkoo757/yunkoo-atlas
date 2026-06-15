import type { StorageAdapter } from '@/storage/adapter'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import {
  migrateElectronLibraryIfNeeded,
  migrateFromLocalStorageIfNeeded,
} from '@/storage/migrate'
import { pickPersisted, schedulePersist } from '@/storage/persist'
import { isElectron } from '@/storage/runtime'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'

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
    useStore.setState({
      trades: snapshot.trades,
      strategies: snapshot.strategies,
      starredIds: snapshot.starredIds,
      subscribedIds: snapshot.subscribedIds,
      pinnedStrategyIds: snapshot.pinnedStrategyIds,
      display: snapshot.display,
    })
  }

  hydrated = true
  useSaveStatus.getState().setSaved()

  useStore.subscribe((state) => {
    if (!hydrated) return
    schedulePersist(pickPersisted(state))
  })
}
