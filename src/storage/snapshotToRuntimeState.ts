import { normalizeQuickNotes } from '@/data/quickNotes'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import { normalizeSelectableSymbolCatalog, normalizeSymbolIcons } from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { assertValidLiveStageState } from '@/lib/liveStages'
import { normalizeTrades } from '@/lib/tradeKind'
import { syncReviewCaseSourceNotes } from '@/lib/reviewCaseSources'
import { normalizeReviewPoolLayout } from '@/lib/reviewPools'
import { createDefaultUserProfile, DEFAULT_USER_DISPLAY_NAME } from '@/config/defaultProfile'
import type { CanonicalSnapshot } from '@/storage/snapshotCodec'
import type { PersistedSnapshot, UserProfile } from '@/storage/types'

/** Pure runtime projection; archive decoding and persistence ownership remain at their boundaries. */
export function snapshotToRuntimeState(snapshot: PersistedSnapshot, missingProfile?: UserProfile) {
  assertValidLiveStageState(snapshot)
  const normalized = normalizeTradeStrategyReferences(snapshot.trades, snapshot.strategies)
  const trades = syncReviewCaseSourceNotes(normalizeTrades(normalized.trades))
  const profile = snapshot.profile
  return {
    profile: profile ? {
      avatarId: profile.avatarId ?? null,
      displayName: profile.displayName || DEFAULT_USER_DISPLAY_NAME,
      customAvatarDataUrl: profile.customAvatarDataUrl ?? null,
      legacyCashCurrencyAssumption: profile.legacyCashCurrencyAssumption
        ? { ...profile.legacyCashCurrencyAssumption }
        : null,
    } : missingProfile ?? createDefaultUserProfile(),
    trades,
    backtestProjects: snapshot.backtestProjects ?? [],
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
    symbolCatalog: normalizeSelectableSymbolCatalog(
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
  } satisfies Omit<CanonicalSnapshot, 'shortcuts'>
}
