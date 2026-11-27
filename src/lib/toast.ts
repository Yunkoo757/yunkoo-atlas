import { useSyncExternalStore } from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export type ToastOptions = {
  tone?: ToastTone
  actionLabel?: string
  onAction?: () => void
  persistent?: boolean
  dedupeKey?: string
  /** 兼容旧调用；新代码使用 actionLabel。 */
  label?: string
  /** 兼容旧调用；新代码使用 onAction。 */
  onClick?: () => void
}

export type ToastItem = {
  id: number
  message: string
  tone: ToastTone
  actionLabel: string | null
  onAction: (() => void) | null
  persistent: boolean
  dedupeKey: string | null
}

export type ToastState = {
  items: ToastItem[]
  /** 以下字段保留一轮迁移兼容，指向队列最新项。 */
  id: number
  message: string | null
  actionLabel: string | null
  onAction: (() => void) | null
  show: (message: string, options?: ToastOptions) => void
  dismiss: (id?: number) => void
}

export type ToastStore = {
  readonly suspended: boolean
  setSuspended: (suspended: boolean) => void
  hold: (id: number, reason: 'pointer' | 'focus', active: boolean) => void
  push: (message: string, options?: ToastOptions) => number | null
  dismiss: (id?: number) => void
  getState: () => ToastState
  subscribe: (listener: () => void) => () => void
  setState: (next: Partial<ToastState> | ToastState) => void
}

const MAX_TOASTS = 3

function needsAttention(item: Pick<ToastItem, 'persistent' | 'onAction' | 'tone'>): boolean {
  return item.persistent || Boolean(item.onAction) || item.tone === 'error'
}

function releaseTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void }
  maybeNodeTimer.unref?.()
}

export function createToastStore(options: { canPush?: () => boolean } = {}): ToastStore {
  const listeners = new Set<() => void>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const holds = new Map<number, Set<'pointer' | 'focus'>>()
  let queue: ToastItem[] = []
  let suspended = false
  let nextId = 1
  let state: ToastState

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const makeState = (items: ToastItem[]): ToastState => {
    const latest = items.at(-1) ?? null
    return {
      items,
      id: latest?.id ?? 0,
      message: latest?.message ?? null,
      actionLabel: latest?.actionLabel ?? null,
      onAction: latest?.onAction ?? null,
      show: (message, toastOptions) => {
        store.push(message, toastOptions)
      },
      dismiss: (id) => store.dismiss(id),
    }
  }

  const cancelTimer = (id: number) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  const scheduleDismiss = (item: ToastItem) => {
    cancelTimer(item.id)
    if (item.persistent || holds.has(item.id)) return
    const duration = item.actionLabel || item.tone === 'warning' ? 5_000 : 3_200
    const timer = setTimeout(() => store.dismiss(item.id), duration)
    releaseTimer(timer)
    timers.set(item.id, timer)
  }

  // 计时从通知真正可见时开始。等待展示的撤销和错误仍可以按 id 更新或撤回。
  const publish = (refreshedId?: number) => {
    const visible = suspended ? [] : queue.slice(0, MAX_TOASTS)
    const previous = state.items
    for (const item of previous) {
      if (!visible.some(next => next.id === item.id)) {
        cancelTimer(item.id)
        holds.delete(item.id)
      }
    }
    state = makeState(visible)
    for (const item of visible) {
      if (item.id === refreshedId || !previous.some(old => old.id === item.id)) scheduleDismiss(item)
    }
    emit()
  }

  const replaceable = (item: ToastItem) => !needsAttention(item) && !holds.has(item.id)

  const store: ToastStore = {
    get suspended() { return suspended },
    setSuspended(next) {
      if (next === suspended) return
      suspended = next
      if (suspended) queue = queue.filter(needsAttention)
      publish()
    },
    hold(id, reason, active) {
      const item = state.items.find(candidate => candidate.id === id)
      if (!item || item.persistent) return
      const reasons = holds.get(id) ?? new Set<'pointer' | 'focus'>()
      if (active) {
        reasons.add(reason)
        holds.set(id, reasons)
        cancelTimer(id)
      } else if (reasons.delete(reason) && !reasons.size) {
        holds.delete(id)
        scheduleDismiss(item)
      }
    },
    push(message, toastOptions = {}) {
      if (options.canPush && !options.canPush()) return null
      const tone = toastOptions.tone ?? 'info'
      const actionLabel = toastOptions.actionLabel ?? toastOptions.label ?? null
      const onAction = toastOptions.onAction ?? toastOptions.onClick ?? null
      const persistent = toastOptions.persistent ?? tone === 'error'
      if (suspended && !needsAttention({ tone, onAction, persistent })) return null
      const dedupeKey = toastOptions.dedupeKey ?? null
      const existingIndex = dedupeKey
        ? queue.findIndex((item) => item.dedupeKey === dedupeKey)
        : queue.findIndex((item) =>
            item.onAction === onAction &&
            item.message === message &&
            item.actionLabel === actionLabel &&
            item.tone === tone,
          )
      const id = existingIndex >= 0 ? queue[existingIndex]!.id : nextId++
      const item: ToastItem = {
        id,
        message,
        tone,
        actionLabel,
        onAction,
        persistent,
        dedupeKey,
      }
      if (existingIndex >= 0) {
        queue[existingIndex] = item
      } else {
        if (queue.length >= MAX_TOASTS) {
          const firstRoutine = queue.findIndex(replaceable)
          if (firstRoutine >= 0) queue.splice(firstRoutine, 1)
        }
        queue.push(item)
      }
      publish(id)
      return id
    },
    dismiss(id) {
      const remaining = id === undefined ? [] : queue.filter(item => item.id !== id)
      if (remaining.length === queue.length) return
      queue = remaining
      publish()
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setState(next) {
      const explicitItems = 'items' in next ? next.items : undefined
      if (explicitItems) {
        for (const item of state.items) cancelTimer(item.id)
        holds.clear()
        queue = suspended ? explicitItems.filter(needsAttention) : [...explicitItems]
        state = makeState([])
        nextId = Math.max(1, ...explicitItems.map((item) => item.id + 1))
        publish()
        return
      }
      if (next.message === null) {
        store.dismiss()
        if (typeof next.id === 'number') nextId = Math.max(1, next.id + 1)
      }
    },
  }

  state = makeState([])
  return store
}

const toastStore = createToastStore()

type ToastHook = {
  <T>(selector: (state: ToastState) => T): T
  getState: ToastStore['getState']
  subscribe: ToastStore['subscribe']
  setState: ToastStore['setState']
  hold: ToastStore['hold']
}

export const useToast: ToastHook = Object.assign(
  function useToastSelector<T>(selector: (state: ToastState) => T): T {
    return useSyncExternalStore(
      toastStore.subscribe,
      () => selector(toastStore.getState()),
      () => selector(toastStore.getState()),
    )
  },
  {
    getState: toastStore.getState,
    subscribe: toastStore.subscribe,
    setState: toastStore.setState,
    hold: toastStore.hold,
  },
)

export function lockBottomChrome(): void {
  toastStore.setSuspended(true)
}

export function unlockBottomChrome(): void {
  toastStore.setSuspended(false)
}

export function isBottomChromeLocked(): boolean {
  return toastStore.suspended
}

export function toast(message: string, options?: ToastOptions): number | null {
  return toastStore.push(message, options)
}
