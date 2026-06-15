import type { PersistedSnapshot } from '@/storage/types'
import { getStorage } from '@/storage/index'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'

const SAVE_DEBOUNCE_MS = 400

let timer: ReturnType<typeof setTimeout> | null = null
let pending: PersistedSnapshot | null = null
let flushing: Promise<void> | null = null

export function pickPersisted(state: {
  trades: PersistedSnapshot['trades']
  strategies: PersistedSnapshot['strategies']
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: PersistedSnapshot['display']
}): PersistedSnapshot {
  return {
    trades: state.trades,
    strategies: state.strategies,
    starredIds: state.starredIds,
    subscribedIds: state.subscribedIds,
    pinnedStrategyIds: state.pinnedStrategyIds,
    display: state.display,
  }
}

async function flush(): Promise<void> {
  if (!pending) return
  const snapshot = pending
  pending = null
  useSaveStatus.getState().setSaving()
  try {
    await getStorage().saveSnapshot(snapshot)
    useSaveStatus.getState().setSaved()
  } catch (e) {
    console.error('Persist failed', e)
    useSaveStatus.getState().setError()
    pending = snapshot
  }
}

export function schedulePersist(snapshot: PersistedSnapshot): void {
  pending = snapshot
  useSaveStatus.getState().setDirty()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushing = flush().finally(() => {
      flushing = null
    })
  }, SAVE_DEBOUNCE_MS)
}

export async function flushPersistNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (flushing) await flushing
  if (!pending) {
    pending = pickPersisted(useStore.getState())
  }
  await flush()
}
