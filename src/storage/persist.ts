import type { PersistedSnapshot } from '@/storage/types'
import { getStorage } from '@/storage/index'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import type { ShortcutBinding } from '@/shortcuts/types'

/** 全量快照写盘：过短易在笔记连改时 thrash；过长影响「已保存」体感。 */
const SAVE_DEBOUNCE_MS = 400

let preFlushCallback: (() => Promise<void>) | null = null

export function setPreFlushCallback(cb: (() => Promise<void>) | null): void {
  preFlushCallback = cb
}

let timer: ReturnType<typeof setTimeout> | null = null
let pending: PersistedSnapshot | null = null
let flushing: Promise<void> | null = null
/** >0 时只记 pending，不启 debounce 写盘（批量导入等） */
let suspendDepth = 0

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
  savedTradeViews: PersistedSnapshot['savedTradeViews']
  symbolIcons: PersistedSnapshot['symbolIcons']
  symbolCatalog: PersistedSnapshot['symbolCatalog']
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
    savedTradeViews: state.savedTradeViews,
    symbolIcons: state.symbolIcons,
    symbolCatalog: state.symbolCatalog,
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
  if (suspendDepth > 0) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushing = flush().finally(() => {
      flushing = null
    })
  }, SAVE_DEBOUNCE_MS)
}

/** 暂停自动 debounce 写盘；可嵌套。仍会标记 dirty / 更新 pending。 */
export function suspendPersist(): void {
  suspendDepth++
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** 结束暂停；默认立刻 flush 一次。 */
export function resumePersist(options?: { flushNow?: boolean }): void {
  suspendDepth = Math.max(0, suspendDepth - 1)
  if (suspendDepth > 0) return
  if (options?.flushNow === false) {
    if (pending) schedulePersist(pending)
    return
  }
  void flushPersistNow()
}

/** 批量变更期间挂起 persist，结束后单次 flush。 */
export async function withPersistSuspended<T>(fn: () => T | Promise<T>): Promise<T> {
  suspendPersist()
  try {
    return await Promise.resolve(fn())
  } finally {
    resumePersist({ flushNow: true })
  }
}

/** 测试用：当前挂起深度 */
export function getPersistSuspendDepth(): number {
  return suspendDepth
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
