import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { DEFAULT_STRATEGIES } from '@/data/strategies'
import {
  createDefaultMistakeTagPresets,
  createDefaultTagPresets,
  createDefaultUserProfile,
} from '@/config/defaultProfile'
import { createDefaultReviewTemplates } from '@/data/reviewTemplates'
import { DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { normalizeReviewPoolLayout } from '@/lib/reviewPools'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
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
  const empty = createEmptyPersistedSnapshot()
  useStore.setState({
    trades: [],
    backtestProjects: [],
    liveStages: empty.liveStages,
    currentLiveStageId: empty.currentLiveStageId,
    scheduledStageRollover: empty.scheduledStageRollover,
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
    weeklyReviews: [],
    quickNotes: [],
    strategies: DEFAULT_STRATEGIES.map((strategy) => ({ ...strategy })),
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    composerProjectId: null,
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    tagPresets: createDefaultTagPresets(),
    mistakeTagPresets: createDefaultMistakeTagPresets(),
    display: { ...DEFAULT_DISPLAY },
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
    reviewTemplates: createDefaultReviewTemplates(),
    reviewPoolPresets: [],
    reviewPoolLayout: normalizeReviewPoolLayout(undefined, []),
  })
  useStore.getState().hydrateProfile(createDefaultUserProfile())
  useShortcutStore.getState().hydrateBindings({})
}

export function clearSessionUiAfterLibrarySwitch(): void {
  useStore.setState({
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    composerProjectId: null,
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
  })
  useShortcutStore.setState({ listContext: null, lightbox: null })
  useSaveStatus.getState().reset()
}
