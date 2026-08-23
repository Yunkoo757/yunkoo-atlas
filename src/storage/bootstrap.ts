import { getStorage } from '@/storage/provider'
export { getStorage } from '@/storage/provider'
import {
  migrateElectronLibraryIfNeeded,
  migrateFromLocalStorageIfNeeded,
} from '@/storage/migrate'
import { enablePersistWrites, pickPersisted, schedulePersist } from '@/storage/persist'
import { useShortcutStore } from '@/store/shortcutStore'
import { isElectron } from '@/storage/runtime'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeSymbolIcons, normalizeSymbolCatalog } from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import type { PersistedSnapshot } from '@/storage/types'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeReviewPoolLayout } from '@/lib/reviewPools'
import { normalizeQuickNotes } from '@/data/quickNotes'
import { assertValidLiveStageState } from '@/lib/liveStages'
import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
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

/**
 * Zustand 内的持久化字段均采用不可变更新；引用未变化代表无需重写全量快照。
 * shortcuts 由独立 store 的订阅负责，不在此处重复比较。
 */
export function haveSamePersistedReferences(
  previous: PersistedSnapshot,
  next: PersistedSnapshot,
): boolean {
  return PERSISTED_STATE_REFERENCE_KEYS.every((key) => previous[key] === next[key])
}

export function isStorageHydrated(): boolean {
  return hydrated
}

/** 在完整权威快照刷新期间抑制订阅回写，并把刷新后的 Store 设为新耐久基线。 */
export function publishDurableStoreRefresh(publish: () => void): void {
  if (persistedSnapshotCoordinator) persistedSnapshotCoordinator.publishDurable(publish)
  else publish()
}

async function runBootstrapStorage(): Promise<void> {
  const adapter = getStorage()
  await adapter.open()

  if (isElectron()) {
    try {
      const state = await window.journalBridge?.getWindowHotkey()
      useShortcutStore.getState().setWindowHotkeyState(state ?? null)
    } catch {
      useShortcutStore.getState().setWindowHotkeyState(null)
    }
  }

  if (!isElectron()) {
    const manifest = await adapter.getManifest()
    await initializeWebWriterOwnership(manifest.libraryId)
  }

  if (isElectron()) {
    await migrateElectronLibraryIfNeeded(adapter)
  } else if (getWebWriteGuardState().phase === 'editable') {
    await migrateFromLocalStorageIfNeeded(adapter)
  }

  const snapshot = await adapter.loadSnapshot()
  let reconciledWindowHotkeyConflict = false
  if (snapshot) {
    // 阶段图是全部运行时写入的归属根；无效快照必须在开启持久化前终止启动。
    assertValidLiveStageState(snapshot)
    const normalized = normalizeTradeStrategyReferences(snapshot.trades, snapshot.strategies)
    const trades = normalizeTrades(normalized.trades)
    useStore.setState({
      trades,
      liveStages: snapshot.liveStages.map((stage) => ({ ...stage })),
      currentLiveStageId: snapshot.currentLiveStageId,
      scheduledStageRollover: snapshot.scheduledStageRollover
        ? { ...snapshot.scheduledStageRollover }
        : null,
      weeklyRiskPreparations: snapshot.weeklyRiskPreparations,
      riskPolicyVersions: snapshot.riskPolicyVersions,
      monthlyRiskLimits: snapshot.monthlyRiskLimits,
      riskOverrideEvents: snapshot.riskOverrideEvents,
      weeklyReviews: normalizeWeeklyReviews(snapshot.weeklyReviews),
      quickNotes: normalizeQuickNotes(snapshot.quickNotes),
      strategies: normalized.strategies,
      starredIds: snapshot.starredIds,
      subscribedIds: snapshot.subscribedIds,
      pinnedStrategyIds: snapshot.pinnedStrategyIds,
      display: normalizeDisplay(snapshot.display),
      tagPresets: mergeTagPresets(snapshot.tagPresets ?? []),
      mistakeTagPresets: mergeTagPresets(snapshot.mistakeTagPresets ?? []),
      savedTradeViews: normalizeSavedTradeViews(snapshot.savedTradeViews),
      symbolIcons: normalizeSymbolIcons(snapshot.symbolIcons),
      symbolCatalog: normalizeSymbolCatalog(
        snapshot.symbolCatalog ?? [
          ...Object.keys(normalizeSymbolIcons(snapshot.symbolIcons)),
          ...trades.map((trade) => trade.symbol),
        ],
      ),
      reviewTemplates: normalizeReviewTemplates(snapshot.reviewTemplates),
      reviewPoolPresets: snapshot.reviewPoolPresets ?? [],
      reviewPoolLayout: normalizeReviewPoolLayout(
        snapshot.reviewPoolLayout,
        (snapshot.reviewPoolPresets ?? []).map((preset) => preset.id),
      ),
    })
    useStore.getState().hydrateProfile(snapshot.profile)
    reconciledWindowHotkeyConflict =
      useShortcutStore.getState().hydrateBindings(snapshot.shortcuts).length > 0
  }

  hydrated = true
  enablePersistWrites()
  // 启动后保持 idle，避免顶栏立刻插入「已保存」把视图按钮挤一下
  useSaveStatus.getState().reset()

  const capturePersisted = () => pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
  const initialPersisted = capturePersisted()
  const coordinator = createPersistedSnapshotCoordinator(initialPersisted, {
    capture: capturePersisted,
    schedule: schedulePersist,
  })
  persistedSnapshotCoordinator = coordinator
  useStore.subscribe((state) => {
    if (!hydrated) return
    const nextPersisted = pickPersisted(state, useShortcutStore.getState().bindings)
    coordinator.observe(nextPersisted, { source: 'store' })
  })

  useShortcutStore.subscribe((state, prev) => {
    if (!hydrated) return
    if (state.bindings === prev.bindings) return
    coordinator.observe(
      pickPersisted(useStore.getState(), state.bindings),
      { source: 'shortcuts' },
    )
  })
  if (reconciledWindowHotkeyConflict) schedulePersist(capturePersisted())
}

export function bootstrapStorage(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrapStorage().catch((error) => {
      bootstrapPromise = null
      throw error
    })
  }
  return bootstrapPromise
}
