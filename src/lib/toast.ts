import { create } from 'zustand'

interface ToastState {
  id: number
  message: string | null
  actionLabel: string | null
  onAction: (() => void) | null
  show: (message: string, action?: ToastAction) => void
  dismiss: () => void
}

type ToastAction = {
  label: string
  onClick: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
/** 关闭保存回执等占用底部中心时，禁止再弹 toast，避免双条重叠。 */
let bottomChromeLocked = false

export function lockBottomChrome(): void {
  bottomChromeLocked = true
  useToast.getState().dismiss()
}

export function unlockBottomChrome(): void {
  bottomChromeLocked = false
}

export function isBottomChromeLocked(): boolean {
  return bottomChromeLocked
}

export const useToast = create<ToastState>((set, get) => ({
  id: 0,
  message: null,
  actionLabel: null,
  onAction: null,
  show: (message, action) => {
    if (bottomChromeLocked) return
    if (timer) clearTimeout(timer)
    const actionLabel = action?.label ?? null
    const onAction = action?.onClick ?? null
    const current = get()
    // 相同文案仅刷新计时，避免无意义 remount 造成叠影闪烁。
    const sameVisible =
      current.message === message &&
      current.actionLabel === actionLabel &&
      current.message !== null
    set({
      id: sameVisible ? current.id : current.id + 1,
      message,
      actionLabel,
      onAction,
    })
    timer = setTimeout(
      () => set({ message: null, actionLabel: null, onAction: null }),
      action ? 5000 : 2200,
    )
  },
  dismiss: () => {
    if (timer) clearTimeout(timer)
    timer = null
    set({ message: null, actionLabel: null, onAction: null })
  },
}))

export function toast(message: string, action?: ToastAction) {
  useToast.getState().show(message, action)
}
