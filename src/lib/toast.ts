import { create } from 'zustand'

interface ToastState {
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

export const useToast = create<ToastState>((set) => ({
  message: null,
  actionLabel: null,
  onAction: null,
  show: (message, action) => {
    if (timer) clearTimeout(timer)
    set({
      message,
      actionLabel: action?.label ?? null,
      onAction: action?.onClick ?? null,
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
