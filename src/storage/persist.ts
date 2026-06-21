import type { PersistedSnapshot } from '@/storage/types'
import { getStorage } from '@/storage/index'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import type { ShortcutBinding } from '@/shortcuts/types'

const SAVE_DEBOUNCE_MS = 100

let preFlushCallback: (() => Promise<void>) | null = null

export function setPreFlushCallback(cb: (() => Promise<void>) | null): void {
  preFlushCallback = cb
}

let timer: ReturnType<typeof setTimeout> | null = null
let pending: PersistedSnapshot | null = null
let flushing: Promise<void> | null = null

export function pickPersisted(
  state: {
  trades: PersistedSnapshot['trades']
  strategies: PersistedSnapshot['strategies']
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: PersistedSnapshot['display']
  tagPresets: string[]
  mistakeTagPresets: string[]
  profile: PersistedSnapshot['profile']
  cases: PersistedSnapshot['cases']
  disputeTypes: PersistedSnapshot['disputeTypes']
},
  shortcutBindings?: Record<string, ShortcutBinding | null>,
): PersistedSnapshot {
  const shortcuts = bindingsForPersist(shortcutBindings ?? {})
  return {
    trades: state.trades,
    strategies: state.strategies,
    starredIds: state.starredIds,
    subscribedIds: state.subscribedIds,
    pinnedStrategyIds: state.pinnedStrategyIds,
    display: state.display,
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
    profile: state.profile,
    cases: state.cases,
    disputeTypes: state.disputeTypes,
    ...(Object.keys(shortcuts).length > 0 ? { shortcuts } : {}),
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

/** 是否有未持久化的变更（用于 beforeunload 避免无条件弹窗） */
export function hasPendingChanges(): boolean {
  return !!pending || useSaveStatus.getState().status === 'dirty'
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

  if (preFlushCallback) {
    try { await preFlushCallback() } catch { /* 不回滚——尽力而为 */ }
  }

  // 始终从最新 store 重建 pending，不依赖之前的 schedulePersist 设置
  pending = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
  await flush()
}
