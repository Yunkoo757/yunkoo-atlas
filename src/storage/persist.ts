import type { PersistedSnapshot } from '@/storage/types'
import { getStorage } from '@/storage/index'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import type { ShortcutBinding } from '@/shortcuts/types'

/** 全量快照写盘：过短易在笔记连改时 thrash；过长影响「已保存」体感。 */
const SAVE_DEBOUNCE_MS = 400
const MAX_STABLE_PREFLUSH_WRITES = 8

let preFlushCallback: (() => Promise<void>) | null = null

export function setPreFlushCallback(cb: (() => Promise<void>) | null): void {
  preFlushCallback = cb
}

let timer: ReturnType<typeof setTimeout> | null = null
let pending: PersistedSnapshot | null = null
let flushing: Promise<void> | null = null
let explicitFlushing: Promise<void> | null = null
/** >0 时只记 pending，不启 debounce 写盘（批量导入等） */
let suspendDepth = 0
/**
 * bootstrap 完成前禁止写盘。否则 visibilitychange / beforeunload
 * 会把默认空 store（含空头像）盖掉 journal.db。
 */
let persistWritesEnabled = false

/** 仅由 bootstrapStorage 在 hydrate 成功后打开。 */
export function enablePersistWrites(): void {
  persistWritesEnabled = true
}

/** 切库 / 测试重置时关闭，避免未 hydrate 的空快照落盘。 */
export function disablePersistWrites(): void {
  persistWritesEnabled = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending = null
}

export function pickPersisted(
  state: {
  trades: PersistedSnapshot['trades']
  weeklyReviews: NonNullable<PersistedSnapshot['weeklyReviews']>
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
  reviewTemplates: NonNullable<PersistedSnapshot['reviewTemplates']>
},
  shortcutBindings?: Record<string, ShortcutBinding | null>,
): PersistedSnapshot {
  const shortcuts = bindingsForPersist(shortcutBindings ?? {})
  return {
    trades: state.trades,
    weeklyReviews: state.weeklyReviews,
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
    reviewTemplates: state.reviewTemplates,
    ...(Object.keys(shortcuts).length > 0 ? { shortcuts } : {}),
  }
}

async function flush(): Promise<void> {
  while (pending) {
    const snapshot = pending
    pending = null
    useSaveStatus.getState().setSaving()
    try {
      await getStorage().saveSnapshot(snapshot)
    } catch (e) {
      console.error('Persist failed', e)
      useSaveStatus.getState().setError(e)
      // 若写盘期间已有更新快照到达，保留更新的完整快照；否则重试本次快照。
      pending ??= snapshot
      throw e
    }
  }
  // flush 期间 schedulePersist 可能创建了 debounce timer；最新快照已由上面的循环追写，
  // 此时清除尾随 timer，避免 400ms 后空跑并错误改写保存状态。
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  useSaveStatus.getState().setSaved()
}

function startPendingFlush(): Promise<void> {
  if (flushing) return flushing
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const operation = flush().finally(() => {
    if (flushing === operation) flushing = null
  })
  flushing = operation
  return operation
}

/** 是否有未持久化的变更（用于 beforeunload 避免无条件弹窗） */
export function hasPendingChanges(): boolean {
  const status = useSaveStatus.getState().status
  return !!pending || status === 'dirty' || status === 'saving' || status === 'error'
}

export function schedulePersist(snapshot: PersistedSnapshot): void {
  if (!persistWritesEnabled) return
  pending = snapshot
  useSaveStatus.getState().setDirty()
  if (suspendDepth > 0) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void startPendingFlush()
      .catch(() => {
        // 自动保存失败会保留 pending，并由保存状态提示；显式 flush 仍会抛错。
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
  void flushPersistNow().catch(() => {})
}

/** 路径已切换但新库 hydrate 失败时，丢弃旧库待写并释放一层暂停。 */
export function discardPendingAndResumePersist(): void {
  suspendDepth = Math.max(0, suspendDepth - 1)
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending = null
  useSaveStatus.getState().reset()
}

/** 结束暂停并等待最终快照真正写盘，供切库、导入和恢复使用。 */
export async function resumePersistAndFlush(): Promise<void> {
  suspendDepth = Math.max(0, suspendDepth - 1)
  if (suspendDepth > 0) return
  await flushPersistNow()
}

/** 批量变更期间挂起 persist，结束后单次 flush。 */
export async function withPersistSuspended<T>(fn: () => T | Promise<T>): Promise<T> {
  suspendPersist()
  try {
    return await Promise.resolve(fn())
  } finally {
    await resumePersistAndFlush()
  }
}

/** 测试用：当前挂起深度 */
export function getPersistSuspendDepth(): number {
  return suspendDepth
}

export async function flushPersistNow(): Promise<void> {
  if (!persistWritesEnabled) return
  const previous = explicitFlushing
  const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (flushing) await flushing

    if (!preFlushCallback) {
      pending = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
      await startPendingFlush()
      return
    }

    // 笔记草稿不经过 schedulePersist。每次写盘结束后再次执行 pre-flush，
    // 直到回调不再改变 store，才能确认 active save 期间没有新草稿遗漏。
    let writes = 0
    while (true) {
      if (writes > 0) useSaveStatus.getState().setSaving()
      const stateBefore = useStore.getState()
      const shortcutsBefore = useShortcutStore.getState().bindings
      try {
        await preFlushCallback()
      } catch (error) {
        pending = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
        useSaveStatus.getState().setError(error)
        throw error
      }
      const stateAfter = useStore.getState()
      const shortcutsAfter = useShortcutStore.getState().bindings
      const stable = stateAfter === stateBefore && shortcutsAfter === shortcutsBefore

      if (writes > 0 && stable) {
        useSaveStatus.getState().setSaved()
        return
      }
      if (writes >= MAX_STABLE_PREFLUSH_WRITES) {
        pending = pickPersisted(stateAfter, shortcutsAfter)
        const error = new Error('保存过程中内容持续变化，请稍后重试')
        useSaveStatus.getState().setError(error)
        throw error
      }

      pending = pickPersisted(stateAfter, shortcutsAfter)
      await startPendingFlush()
      writes += 1
    }
  })
  explicitFlushing = operation
  void operation.then(
    () => {
      if (explicitFlushing === operation) explicitFlushing = null
    },
    () => {
      if (explicitFlushing === operation) explicitFlushing = null
    },
  )
  return operation
}
