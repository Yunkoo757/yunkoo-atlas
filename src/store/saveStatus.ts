import { create } from 'zustand'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface SaveStatusState {
  status: SaveStatus
  errorMessage: string | null
  setDirty: () => void
  setSaving: () => void
  setSaved: () => void
  setError: (error?: unknown) => void
  reset: () => void
}

function getSaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return '无法写入本地交易库'
}

export const useSaveStatus = create<SaveStatusState>((set) => ({
  status: 'idle',
  errorMessage: null,
  setDirty: () => set({ status: 'dirty', errorMessage: null }),
  setSaving: () => set({ status: 'saving', errorMessage: null }),
  setSaved: () => set({ status: 'saved', errorMessage: null }),
  setError: (error) => set({ status: 'error', errorMessage: getSaveErrorMessage(error) }),
  reset: () => set({ status: 'idle', errorMessage: null }),
}))
