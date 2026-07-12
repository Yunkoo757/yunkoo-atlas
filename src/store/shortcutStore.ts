import { create } from 'zustand'
import type { ListNavigationContext, ShortcutBinding } from '@/shortcuts/types'
import { getActionMeta, SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { isSequence } from '@/shortcuts/chords'
import { buildBindingOverwritePatch } from '@/shortcuts/engine'

export interface LightboxState {
  images: string[]
  index: number
}

interface ShortcutState {
  bindings: Record<string, ShortcutBinding | null>
  listContext: ListNavigationContext | null
  lightbox: LightboxState | null
  cmdkOpen: boolean
  dataIOOpen: boolean
  setBinding: (id: string, binding: ShortcutBinding | null) => void
  /** 写入绑定；若与其他动作冲突则清空对方（固定序列除外） */
  assignBinding: (
    id: string,
    binding: ShortcutBinding | null,
  ) => { ok: true; clearedLabels: string[] } | { ok: false; error: string }
  resetBinding: (id: string) => void
  resetAllBindings: () => void
  setListContext: (ctx: ListNavigationContext | null) => void
  openLightbox: (images: string[], index: number) => void
  closeLightbox: () => void
  lightboxPrev: () => void
  lightboxNext: () => void
  setCmdkOpen: (open: boolean) => void
  setDataIOOpen: (open: boolean) => void
  hydrateBindings: (bindings: Record<string, ShortcutBinding | null> | undefined) => void
}

export function resolveBinding(
  id: string,
  bindings: Record<string, ShortcutBinding | null>,
): ShortcutBinding | null {
  if (id in bindings) {
    return bindings[id]
  }
  return getActionMeta(id)?.defaultBinding ?? null
}

export function bindingsForPersist(
  bindings: Record<string, ShortcutBinding | null>,
): Record<string, ShortcutBinding | null> {
  const out: Record<string, ShortcutBinding | null> = {}
  for (const action of SHORTCUT_ACTIONS) {
    if (action.sequenceFixed) continue
    if (!(action.id in bindings)) continue
    const b = bindings[action.id]
    const def = action.defaultBinding
    if (b === null) {
      out[action.id] = null
      continue
    }
    if (b === undefined) continue
    const same =
      (isSequence(b) && isSequence(def) && JSON.stringify(b) === JSON.stringify(def)) ||
      (!isSequence(b) && !isSequence(def) && JSON.stringify(b) === JSON.stringify(def))
    if (!same) out[action.id] = b
  }
  return out
}

export const useShortcutStore = create<ShortcutState>()((set, get) => ({
  bindings: {},
  listContext: null,
  lightbox: null,
  cmdkOpen: false,
  dataIOOpen: false,
  setBinding: (id, binding) =>
    set((s) => ({
      bindings: { ...s.bindings, [id]: binding },
    })),
  assignBinding: (id, binding) => {
    const result = buildBindingOverwritePatch(id, binding, get().bindings)
    if ('error' in result) {
      return { ok: false as const, error: result.error }
    }
    set((s) => ({
      bindings: { ...s.bindings, ...result.patch },
    }))
    return { ok: true as const, clearedLabels: result.clearedLabels }
  },
  resetBinding: (id) =>
    set((s) => {
      const next = { ...s.bindings }
      delete next[id]
      return { bindings: next }
    }),
  resetAllBindings: () => set({ bindings: {} }),
  setListContext: (ctx) =>
    set((s) => {
      if (ctx === null) {
        return s.listContext === null ? s : { listContext: null }
      }
      const prev = s.listContext
      if (
        prev &&
        prev.listPath === ctx.listPath &&
        prev.listSearch === ctx.listSearch &&
        prev.orderedIds.length === ctx.orderedIds.length &&
        prev.orderedIds.every((id, i) => id === ctx.orderedIds[i]) &&
        prev.filter.type === ctx.filter.type &&
        prev.filter.strategyId === ctx.filter.strategyId &&
        prev.filter.period === ctx.filter.period &&
        prev.filter.tradeKind === ctx.filter.tradeKind &&
        prev.filter.reviewCaseScope === ctx.filter.reviewCaseScope
      ) {
        return s
      }
      return { listContext: ctx }
    }),
  openLightbox: (images, index) =>
    set({
      lightbox: {
        images,
        index: Math.max(0, Math.min(index, images.length - 1)),
      },
    }),
  closeLightbox: () => set({ lightbox: null }),
  lightboxPrev: () => {
    const lb = get().lightbox
    if (!lb || lb.images.length <= 1) return
    set({
      lightbox: {
        ...lb,
        index: lb.index <= 0 ? lb.images.length - 1 : lb.index - 1,
      },
    })
  },
  lightboxNext: () => {
    const lb = get().lightbox
    if (!lb || lb.images.length <= 1) return
    set({
      lightbox: {
        ...lb,
        index: lb.index >= lb.images.length - 1 ? 0 : lb.index + 1,
      },
    })
  },
  setCmdkOpen: (open) => set({ cmdkOpen: open }),
  setDataIOOpen: (open) => set({ dataIOOpen: open }),
  hydrateBindings: (bindings) =>
    set({ bindings: bindings ? { ...bindings } : {} }),
}))
