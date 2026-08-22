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
import { normalizeQuickNotes } from '@/data/quickNotes'
import { assertValidLiveStageState } from '@/lib/liveStages'
import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import {
  getWebWriteGuardState,
  initializeWebWriterOwnership,
} from '@/storage/webWriteGuard'

let hydrated = false
let bootstrapPromise: Promise<void> | null = null

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
      liveStatsStartTradingDayKey: snapshot.liveStatsStartTradingDayKey ?? null,
      livePerformanceCycles: snapshot.livePerformanceCycles ?? [],
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
    })
    useStore.getState().hydrateProfile(snapshot.profile)
    reconciledWindowHotkeyConflict =
      useShortcutStore.getState().hydrateBindings(snapshot.shortcuts).length > 0
  }

  hydrated = true
  enablePersistWrites()
  // 启动后保持 idle，避免顶栏立刻插入「已保存」把视图按钮挤一下
  useSaveStatus.getState().reset()

  let lastPersisted = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
  useStore.subscribe((state) => {
    if (!hydrated) return
    const nextPersisted = pickPersisted(state, useShortcutStore.getState().bindings)
    if (haveSamePersistedReferences(lastPersisted, nextPersisted)) return
    lastPersisted = nextPersisted
    schedulePersist(nextPersisted)
  })

  useShortcutStore.subscribe((state, prev) => {
    if (!hydrated) return
    if (state.bindings === prev.bindings) return
    lastPersisted = pickPersisted(useStore.getState(), state.bindings)
    schedulePersist(lastPersisted)
  })
  if (reconciledWindowHotkeyConflict) schedulePersist(lastPersisted)
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
