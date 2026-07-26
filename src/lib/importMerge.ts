import { mergeQuickNotes } from '@/data/quickNotes'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import type { Strategy } from '@/data/strategies'
import { mergeSavedTradeViews } from '@/lib/savedTradeViews'
import { ensureStrategies, normalizeTradeStrategyReferences } from '@/lib/strategies'
import { mergeSymbolCatalog, mergeSymbolIcons } from '@/lib/symbolIconCodec'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTradeKind, normalizeTrades } from '@/lib/tradeKind'
import type { ExportPayload, PersistedSlice } from '@/lib/importTypes'

function mergeStrategies(current: Strategy[], imported: Strategy[]): Strategy[] {
  const map = new Map(current.map((strategy) => [strategy.id, strategy]))
  for (const strategy of imported) map.set(strategy.id, strategy)
  return Array.from(map.values())
}

function mergeImmutableById<T extends { id: string }>(current: T[], imported: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of imported) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

export function mergeImportPayload(current: PersistedSlice, payload: ExportPayload): PersistedSlice {
  const combinedStrategies = mergeStrategies(current.strategies, ensureStrategies(payload.strategies))
  const { strategies, trades: migrated } = normalizeTradeStrategyReferences(
    payload.trades,
    combinedStrategies,
  )
  const tradeMap = new Map(current.trades.map((trade) => [trade.id, trade]))
  for (const trade of migrated) {
    const existing = tradeMap.get(trade.id)
    if (
      existing &&
      normalizeTradeKind(trade.tradeKind as string | undefined) !==
        normalizeTradeKind(existing.tradeKind as string | undefined)
    ) {
      continue
    }
    tradeMap.set(trade.id, trade)
  }
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
    trades: normalizeTrades(Array.from(tradeMap.values())),
    weeklyRiskPreparations: mergeImmutableById(
      current.weeklyRiskPreparations ?? [],
      payload.weeklyRiskPreparations ?? [],
    ).map((preparation) => {
      const local = current.weeklyRiskPreparations?.find((item) => item.id === preparation.id)
      const imported = payload.weeklyRiskPreparations?.find((item) => item.id === preparation.id)
      if (!local) return imported ?? preparation
      if (!imported) return local
      return Date.parse(imported.updatedAt) > Date.parse(local.updatedAt) ? imported : local
    }),
    riskPolicyVersions: mergeImmutableById(current.riskPolicyVersions ?? [], payload.riskPolicyVersions ?? []),
    monthlyRiskLimits: mergeImmutableById(current.monthlyRiskLimits ?? [], payload.monthlyRiskLimits ?? []),
    riskOverrideEvents: mergeImmutableById(current.riskOverrideEvents ?? [], payload.riskOverrideEvents ?? []),
    weeklyReviews: normalizeWeeklyReviews([
      ...(current.weeklyReviews ?? []),
      ...(payload.weeklyReviews ?? []),
    ]),
    quickNotes: mergeQuickNotes(current.quickNotes ?? [], payload.quickNotes ?? []),
    starredIds: [...new Set([...current.starredIds, ...payload.starredIds])],
    subscribedIds: [...new Set([...current.subscribedIds, ...payload.subscribedIds])],
    pinnedStrategyIds: [...new Set([...current.pinnedStrategyIds, ...payload.pinnedStrategyIds])],
    display: normalizeDisplay({ ...current.display, ...payload.display }),
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
