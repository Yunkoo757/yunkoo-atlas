import { create } from 'zustand'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface SaveStatusState {
  status: SaveStatus
  setDirty: () => void
  setSaving: () => void
  setSaved: () => void
  setError: () => void
  reset: () => void
}

export const useSaveStatus = create<SaveStatusState>((set) => ({
  status: 'idle',
  setDirty: () => set({ status: 'dirty' }),
  setSaving: () => set({ status: 'saving' }),
  setSaved: () => set({ status: 'saved' }),
  setError: () => set({ status: 'error' }),
  reset: () => set({ status: 'idle' }),
}))
