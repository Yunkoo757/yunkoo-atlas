export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export type ToastOptions = {
  tone?: ToastTone
  actionLabel?: string
  onAction?: () => void
  persistent?: boolean
  dedupeKey?: string
}

export type ToastItem = Readonly<{
  id: number
  message: string
  tone: ToastTone
  actionLabel: string | null
  onAction: (() => void) | null
  persistent: boolean
  dedupeKey: string | null
}>

type ToastStore = {
  setSuspended: (suspended: boolean) => void
  hold: (id: number, reason: 'pointer' | 'focus', active: boolean) => void
  push: (message: string, options?: ToastOptions) => number | null
  dismiss: (id?: number) => void
  getVisible: () => readonly ToastItem[]
  subscribe: (listener: () => void) => () => void
}

const MAX_TOASTS = 3

function needsAttention(item: Pick<ToastItem, 'persistent' | 'onAction' | 'tone'>): boolean {
  return item.persistent || Boolean(item.onAction) || item.tone === 'error'
}

function releaseTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void }
  maybeNodeTimer.unref?.()
}

export function createToastStore(): ToastStore {
  const listeners = new Set<() => void>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const holds = new Map<number, Set<'pointer' | 'focus'>>()
  let queue: ToastItem[] = []
  let suspended = false
  let nextId = 1
  let visible: ToastItem[] = []

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
    const next = suspended ? [] : queue.slice(0, MAX_TOASTS)
    if (next.length === visible.length && next.every((item, index) => item === visible[index])) return
    const previous = visible
    visible = next
    for (const item of previous) {
      if (!visible.some(next => next.id === item.id)) {
        cancelTimer(item.id)
        holds.delete(item.id)
      }
    }
    for (const item of visible) {
      if (item.id === refreshedId || !previous.some(old => old.id === item.id)) scheduleDismiss(item)
    }
    for (const listener of listeners) listener()
  }

  const replaceable = (item: ToastItem) => !needsAttention(item) && !holds.has(item.id)

  const store: ToastStore = {
    setSuspended(next) {
      if (next === suspended) return
      suspended = next
      if (suspended) queue = queue.filter(needsAttention)
      publish()
    },
    hold(id, reason, active) {
      const item = visible.find(candidate => candidate.id === id)
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
      const tone = toastOptions.tone ?? 'info'
      const actionLabel = toastOptions.actionLabel ?? null
      const onAction = toastOptions.onAction ?? null
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
    getVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return store
}

export const toastStore = createToastStore()
export const toast = toastStore.push
