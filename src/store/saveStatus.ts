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
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const reason = message.replace(/^Error invoking remote method 'storage:saveSnapshot': (?:\w*Error: )?/, '').trim()
  return reason || '无法写入本地资料库'
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
