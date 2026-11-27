import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { createDefaultUserProfile } from '@/config/defaultProfile'
import { useToast } from '@/lib/toast'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { createNewLibrarySnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot } from '@/storage/types'

export function applySnapshotToStore(snapshot: PersistedSnapshot): void {
  useStore.setState({
    ...snapshotToRuntimeState(snapshot),
    undoStack: [],
    redoStack: [],
  })
  useStore.getState().hydrateProfile(snapshot.profile ?? createDefaultUserProfile())
  useShortcutStore.getState().hydrateBindings(snapshot.shortcuts)
}

export function resetEmptyLibraryIntoStore(): void {
  useToast.getState().dismiss()
  const initial = createNewLibrarySnapshot()
  useStore.setState({
    ...snapshotToRuntimeState(initial),
    // 新库首次展示使用批准的预设顺序，已保存的标签在读取时按名称归一。
    tagPresets: initial.tagPresets,
    mistakeTagPresets: initial.mistakeTagPresets,
    undoStack: [],
    redoStack: [],
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    composerProjectId: null,
    composerGroup: null,
    closeTradeRequest: null,
  })
  useStore.getState().hydrateProfile(initial.profile)
  useShortcutStore.getState().hydrateBindings(initial.shortcuts)
}

export function clearSessionUiAfterLibrarySwitch(): void {
  useToast.getState().dismiss()
  useStore.setState({
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    composerProjectId: null,
    composerGroup: null,
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
  })
  useShortcutStore.setState({ listContext: null, lightbox: null })
  useSaveStatus.getState().reset()
}
