import { DEFAULT_STRATEGIES } from '@/data/strategies'
import {
  createDefaultMistakeTagPresets,
  createDefaultTagPresets,
  createDefaultUserProfile,
} from '@/config/defaultProfile'
import { normalizeQuickNotes } from '@/data/quickNotes'
import {
  createDefaultReviewTemplates,
  normalizeReviewTemplates,
} from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import {
  DEFAULT_SYMBOL_CATALOG,
  normalizeSymbolCatalog,
  normalizeSymbolIcons,
} from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { DEFAULT_DISPLAY, normalizeDisplay } from '@/lib/tradeFilters'
import { assertValidLiveStageState } from '@/lib/liveStages'
import { normalizeTrades } from '@/lib/tradeKind'
import { normalizeReviewPoolLayout } from '@/lib/reviewPools'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot } from '@/storage/types'

export function applySnapshotToStore(snapshot: PersistedSnapshot): void {
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
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
  })
  useShortcutStore.setState({ listContext: null, lightbox: null })
  useSaveStatus.getState().reset()
}
