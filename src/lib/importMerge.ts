import { mergeQuickNotes } from '@/data/quickNotes'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import type { Strategy } from '@/data/strategies'
import { mergeSavedTradeViews } from '@/lib/savedTradeViews'
import { ensureStrategies, normalizeTradeStrategyReferences } from '@/lib/strategies'
import { mergeSymbolCatalog, mergeSymbolIcons } from '@/lib/symbolIconCodec'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
import type { ExportPayload, ImportIdentityPayload, PersistedSlice } from '@/lib/importTypes'
import { mergeRiskImport } from '@/lib/riskImportMerge'

function mergeStrategies(current: Strategy[], imported: Strategy[]): Strategy[] {
  const map = new Map(current.map((strategy) => [strategy.id, strategy]))
  for (const strategy of imported) map.set(strategy.id, strategy)
  return Array.from(map.values())
}

export function canonicalImportValue(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0),
    )
  })
}

export function mergeImportPayload(
  current: PersistedSlice,
  payload: ExportPayload,
  payloadDigest = canonicalImportValue(payload),
  identityPayload: ImportIdentityPayload = payload,
): PersistedSlice {
  const combinedStrategies = mergeStrategies(current.strategies, ensureStrategies(payload.strategies))
  const { strategies, trades: migrated } = normalizeTradeStrategyReferences(
    payload.trades,
    combinedStrategies,
  )
  const identityTrades = normalizeTradeStrategyReferences(
    identityPayload.trades,
    combinedStrategies,
  ).trades
  const riskMerged = mergeRiskImport(
    current,
    { ...payload, trades: migrated, strategies },
    payloadDigest,
    identityTrades,
  )
  const templatesById = new Map(
    normalizeReviewTemplates(current.reviewTemplates ?? []).map((template) => [template.id, template]),
  )
  for (const template of payload.reviewTemplates === undefined
    ? []
    : normalizeReviewTemplates(payload.reviewTemplates)) {
    if (!templatesById.has(template.id)) templatesById.set(template.id, template)
  }
  return {
    strategies,
    trades: normalizeTrades(riskMerged.trades),
    liveStatsStartTradingDayKey: current.liveStatsStartTradingDayKey ?? null,
    weeklyRiskPreparations: riskMerged.weeklyRiskPreparations,
    riskPolicyVersions: riskMerged.riskPolicyVersions,
    monthlyRiskLimits: riskMerged.monthlyRiskLimits,
    riskOverrideEvents: riskMerged.riskOverrideEvents,
    weeklyReviews: riskMerged.weeklyReviews,
    quickNotes: mergeQuickNotes(current.quickNotes ?? [], payload.quickNotes ?? []),
    starredIds: riskMerged.starredIds,
    subscribedIds: riskMerged.subscribedIds,
    pinnedStrategyIds: [...new Set([...current.pinnedStrategyIds, ...payload.pinnedStrategyIds])],
    display: normalizeDisplay({
      ...current.display,
      ...payload.display,
      tradingDayStartHour: current.display.tradingDayStartHour,
    }),
    tagPresets: mergeTagPresets(current.tagPresets ?? [], payload.tagPresets ?? []),
    mistakeTagPresets: mergeTagPresets(
      current.mistakeTagPresets ?? [],
      payload.mistakeTagPresets ?? [],
    ),
    savedTradeViews: mergeSavedTradeViews(
      current.savedTradeViews ?? [],
      payload.savedTradeViews ?? [],
    ),
    symbolIcons: mergeSymbolIcons(current.symbolIcons ?? {}, payload.symbolIcons ?? {}),
    symbolCatalog: mergeSymbolCatalog(
      current.symbolCatalog ?? [],
      payload.symbolCatalog ?? [],
    ),
    reviewTemplates: Array.from(templatesById.values()),
  }
}
