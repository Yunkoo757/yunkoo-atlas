import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import type { ShortcutBinding } from '@/shortcuts/types'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import {
  PersistenceController,
  type PersistenceDiagnostics,
} from '@/storage/persistenceController'
import { getStorage } from '@/storage/provider'
import type { CanonicalSnapshot } from '@/storage/snapshotCodec'
import type { PersistedSnapshot } from '@/storage/types'

export function pickPersisted(
  state: Omit<CanonicalSnapshot, 'shortcuts'>,
  shortcutBindings?: Record<string, ShortcutBinding | null>,
): CanonicalSnapshot {
  const shortcuts = bindingsForPersist(shortcutBindings ?? {})
  return {
    trades: state.trades,
    weeklyReviews: state.weeklyReviews,
    quickNotes: state.quickNotes,
    strategies: state.strategies,
    starredIds: state.starredIds,
    subscribedIds: state.subscribedIds,
    pinnedStrategyIds: state.pinnedStrategyIds,
    display: state.display,
    shortcuts,
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
    profile: state.profile,
    savedTradeViews: state.savedTradeViews,
    symbolIcons: state.symbolIcons,
    symbolCatalog: state.symbolCatalog,
    reviewTemplates: state.reviewTemplates,
  }
}

const controller = new PersistenceController({
  async saveSnapshot(snapshot) {
    try {
      await getStorage().saveSnapshot(snapshot)
    } catch (error) {
      console.error('Persist failed', error)
      throw error
    }
  },
  captureSnapshot() {
    const state = useStore.getState()
    const shortcutBindings = useShortcutStore.getState().bindings
    return {
      snapshot: pickPersisted(state, shortcutBindings),
      stateReference: state,
      shortcutReference: shortcutBindings,
    }
  },
  status: {
    getStatus: () => useSaveStatus.getState().status,
    setDirty: () => useSaveStatus.getState().setDirty(),
    setSaving: () => useSaveStatus.getState().setSaving(),
    setSaved: () => useSaveStatus.getState().setSaved(),
    setError: (error) => useSaveStatus.getState().setError(error),
    reset: () => useSaveStatus.getState().reset(),
  },
  clock: {
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
})

export function setPreFlushCallback(callback: (() => Promise<void>) | null): void {
  controller.setPreFlushCallback(callback)
}

export function enablePersistWrites(): void {
  controller.enableWrites()
}

export function disablePersistWrites(): void {
  controller.disableWrites()
}

export function hasPendingChanges(): boolean {
  return controller.hasPendingChanges()
}

export function schedulePersist(snapshot: PersistedSnapshot): void {
  controller.schedule(snapshot)
}

export function suspendPersist(): void {
  controller.suspend()
}

export function resumePersist(options?: { flushNow?: boolean }): void {
  controller.resume(options)
}

export function discardPendingAndResumePersist(): void {
  controller.discardPendingAndResume()
}

export async function resumePersistAndFlush(): Promise<void> {
  await controller.resumeAndFlush()
}

export async function withPersistSuspended<T>(fn: () => T | Promise<T>): Promise<T> {
  suspendPersist()
  try {
    return await Promise.resolve(fn())
  } finally {
    await resumePersistAndFlush()
  }
}

export function getPersistSuspendDepth(): number {
  return controller.getSuspendDepth()
}

export function getPersistenceDiagnostics(): PersistenceDiagnostics {
  return controller.getDiagnostics()
}

export function resetPersistenceDiagnostics(): void {
  controller.resetDiagnostics()
}

export async function flushPersistNow(): Promise<void> {
  await controller.flushNow()
}
