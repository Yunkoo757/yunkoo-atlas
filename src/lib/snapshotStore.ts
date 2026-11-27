import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { createDefaultUserProfile } from '@/config/defaultProfile'
import { useToast } from '@/lib/toast'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { createNewLibrarySnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot } from '@/storage/types'

function publishSnapshot(snapshot: PersistedSnapshot, fields: Partial<ReturnType<typeof useStore.getState>>): void {
  useStore.setState({
    ...snapshotToRuntimeState(snapshot),
    ...fields,
    undoStack: [],
    redoStack: [],
  })
  useStore.getState().hydrateProfile(snapshot.profile ?? createDefaultUserProfile())
  useShortcutStore.getState().hydrateBindings(snapshot.shortcuts)
}

export function applySnapshotToStore(snapshot: PersistedSnapshot): void {
  publishSnapshot(snapshot, {})
}

/** 整库切换、恢复或重载时，旧记录的选择与交易指令和数据在同一次 store 更新中交接。 */
export function replaceLibraryInStore(snapshot: PersistedSnapshot | null): void {
  const source = snapshot ?? createNewLibrarySnapshot()
  // 新库首次展示采用配置中的预设顺序，已有库的标签按读取规则归一。
  const initialTags = snapshot ? {} : {
    tagPresets: source.tagPresets ?? [],
    mistakeTagPresets: source.mistakeTagPresets ?? [],
  }
  publishSnapshot(source, {
    ...initialTags,
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    composerProjectId: null,
    composerGroup: null,
    closeTradeRequest: null,
    pendingTradeOpenRequest: null,
    riskSetupTradeOpenRequest: null,
  })
  useShortcutStore.setState({ listContext: null, lightbox: null })
  useToast.getState().dismiss()
  useSaveStatus.getState().reset()
}
