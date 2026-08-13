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
  push: (message: string, options?: ToastOptions) => number | null
  dismiss: (id?: number) => void
  getState: () => ToastState
  subscribe: (listener: () => void) => () => void
  setState: (next: Partial<ToastState> | ToastState) => void
}

const MAX_TOASTS = 3

function releaseTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void }
  maybeNodeTimer.unref?.()
}

export function createToastStore(options: { canPush?: () => boolean } = {}): ToastStore {
  const listeners = new Set<() => void>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
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
    if (item.persistent) return
    const duration = item.actionLabel ? 5_000 : 2_200
    const timer = setTimeout(() => store.dismiss(item.id), duration)
    releaseTimer(timer)
    timers.set(item.id, timer)
  }

  const store: ToastStore = {
    push(message, toastOptions = {}) {
      if (options.canPush && !options.canPush()) return null
      const tone = toastOptions.tone ?? 'info'
      const actionLabel = toastOptions.actionLabel ?? toastOptions.label ?? null
      const onAction = toastOptions.onAction ?? toastOptions.onClick ?? null
      const persistent = toastOptions.persistent ?? tone === 'error'
      const dedupeKey = toastOptions.dedupeKey ?? null
      const existingIndex = dedupeKey
        ? state.items.findIndex((item) => item.dedupeKey === dedupeKey)
        : state.items.findIndex((item) =>
            item.message === message &&
            item.actionLabel === actionLabel &&
            item.tone === tone,
          )
      const id = existingIndex >= 0 ? state.items[existingIndex]!.id : nextId++
      const item: ToastItem = {
        id,
        message,
        tone,
        actionLabel,
        onAction,
        persistent,
        dedupeKey,
      }
      const nextItems = [...state.items]
      if (existingIndex >= 0) nextItems[existingIndex] = item
      else nextItems.push(item)
      while (nextItems.length > MAX_TOASTS) {
        const removableIndex = nextItems.findIndex((candidate) => !candidate.persistent)
        const [removed] = nextItems.splice(removableIndex >= 0 ? removableIndex : 0, 1)
        if (removed) cancelTimer(removed.id)
      }
      state = makeState(nextItems)
      scheduleDismiss(item)
      emit()
      return id
    },
    dismiss(id) {
      const removed = id === undefined ? state.items : state.items.filter((item) => item.id === id)
      for (const item of removed) cancelTimer(item.id)
      const nextItems = id === undefined
        ? []
        : state.items.filter((item) => item.id !== id)
      if (nextItems.length === state.items.length) return
      state = makeState(nextItems)
      emit()
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
        state = makeState([...explicitItems])
        nextId = Math.max(1, ...explicitItems.map((item) => item.id + 1))
        for (const item of explicitItems) scheduleDismiss(item)
        emit()
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

/** 关闭保存回执等占用底部中心时，禁止再弹 toast，避免双条重叠。 */
let bottomChromeLocked = false
const toastStore = createToastStore({ canPush: () => !bottomChromeLocked })

type ToastHook = {
  <T>(selector: (state: ToastState) => T): T
  getState: ToastStore['getState']
  subscribe: ToastStore['subscribe']
  setState: ToastStore['setState']
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
  },
)

export function lockBottomChrome(): void {
  bottomChromeLocked = true
  toastStore.dismiss()
}

export function unlockBottomChrome(): void {
  bottomChromeLocked = false
}

export function isBottomChromeLocked(): boolean {
  return bottomChromeLocked
}

export function toast(message: string, options?: ToastOptions): number | null {
  return toastStore.push(message, options)
}
