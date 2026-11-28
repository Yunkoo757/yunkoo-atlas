import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { getStorage } from '@/storage/provider'
import {
  migrateElectronLibraryIfNeeded,
  migrateFromLocalStorageIfNeeded,
} from '@/storage/migrate'
import { captureStoreForPersistence } from '@/store/persistedRevision'
import { enablePersistWrites, schedulePersist, storageDocumentSignal } from '@/storage/persist'
import { useShortcutStore } from '@/store/shortcutStore'
import { getJournalBridge } from '@/storage/runtime'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'

import type { PersistedSnapshot } from '@/storage/types'
import type { StorageAdapter } from '@/storage/adapter'
import {
  createPersistedSnapshotCoordinator,
  type PersistedSnapshotCoordinator,
} from '@/storage/persistedSnapshotCoordinator'
import {
  getWebWriteGuardState,
  initializeWebWriterOwnership,
} from '@/storage/webWriteGuard'

let hydrated = false
let bootstrapPromise: Promise<void> | null = null
let persistedSnapshotCoordinator: PersistedSnapshotCoordinator | null = null

export function isStorageHydrated(): boolean {
  return hydrated && !storageDocumentSignal.aborted
}

/** 在完整权威快照刷新期间抑制订阅回写，并把刷新后的 Store 设为新耐久基线。 */
export function publishDurableStoreRefresh(publish: () => void): void {
  if (persistedSnapshotCoordinator) persistedSnapshotCoordinator.publishDurable(publish)
  else publish()
}

/** 已有资料库只读取一次；迁移写入后仍重读，以取得规范化快照和最新 revision。 */
export async function loadBootstrapSnapshot(
  adapter: StorageAdapter,
  mode: 'electron' | 'web-editable' | 'web-readonly',
  indexedDbAdapter?: StorageAdapter,
  signal?: AbortSignal,
): Promise<PersistedSnapshot | null> {
  signal?.throwIfAborted()
  const existing = await adapter.loadSnapshot()
  signal?.throwIfAborted()
  if (existing || mode === 'web-readonly') return existing
  if (mode === 'electron') await migrateElectronLibraryIfNeeded(adapter, indexedDbAdapter, signal)
  else await migrateFromLocalStorageIfNeeded(adapter, signal)
  signal?.throwIfAborted()
  return adapter.loadSnapshot()
}

async function runBootstrapStorage(): Promise<void> {
  const adapter = getStorage()
  await adapter.open()
  const signal = storageDocumentSignal
  signal.throwIfAborted()

  const bridge = getJournalBridge()
  if (bridge) {
    let hotkey = null
    try {
      hotkey = await bridge.getWindowHotkey()
    } catch { /* 窗口快捷键不可读时仍可打开资料库。 */ }
    signal.throwIfAborted()
    useShortcutStore.getState().setWindowHotkeyState(hotkey)
  } else {
    const manifest = await adapter.getManifest()
    signal.throwIfAborted()
    await initializeWebWriterOwnership(manifest.libraryId)
  }

  const mode = bridge ? 'electron' : getWebWriteGuardState().phase === 'editable' ? 'web-editable' : 'web-readonly'
  const snapshot = await loadBootstrapSnapshot(adapter, mode, undefined, signal)
  signal.throwIfAborted()
  let reconciledWindowHotkeyConflict = false
  if (snapshot) {
    // 阶段图是全部运行时写入的归属根；无效快照必须在开启持久化前终止启动。
    useStore.setState(snapshotToRuntimeState(snapshot, useStore.getState().profile))
    signal.throwIfAborted()
    reconciledWindowHotkeyConflict =
      useShortcutStore.getState().hydrateBindings(snapshot.shortcuts).length > 0
  }

  signal.throwIfAborted()
  hydrated = true
  enablePersistWrites(captureStoreForPersistence)
  // 启动后保持 idle，避免顶栏立刻插入「已保存」把视图按钮挤一下
  useSaveStatus.getState().reset()

  const capturePersisted = () => captureStoreForPersistence().snapshot
  const initialPersisted = capturePersisted()
  const coordinator = createPersistedSnapshotCoordinator(initialPersisted, {
    capture: capturePersisted,
    schedule: schedulePersist,
  })
  persistedSnapshotCoordinator = coordinator
  useStore.subscribe(coordinator.observeStore)
  useShortcutStore.subscribe((state, previous) => {
    if (state.bindings !== previous.bindings) coordinator.observeShortcuts()
  })
  if (reconciledWindowHotkeyConflict) schedulePersist(capturePersisted())
}

export function bootstrapStorage(): Promise<void> {
  if (storageDocumentSignal.aborted) return Promise.reject(storageDocumentSignal.reason)
  if (hydrated) return Promise.resolve()
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrapStorage().catch((error) => {
      bootstrapPromise = null
      throw error
    })
  }
  return bootstrapPromise
}
