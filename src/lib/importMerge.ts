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
import { getCurrentLiveStage, type LiveStage } from '@/lib/liveStages'
import { isUsableRiskPolicy } from '@/lib/activeRiskPolicy'
import type { Trade } from '@/data/trades'
import type { ReviewPoolPreset } from '@/lib/reviewPools'
import { stableImportedTradeId } from '@/lib/riskImportMerge'

function mergeReviewPoolPresets(
  current: readonly ReviewPoolPreset[],
  imported: readonly ReviewPoolPreset[],
  payloadDigest: string,
): ReviewPoolPreset[] {
  const merged = new Map(current.map((preset) => [preset.id, preset]))
  for (const preset of imported) {
    const existing = merged.get(preset.id)
    if (!existing) {
      merged.set(preset.id, preset)
      continue
    }
    if (canonicalImportValue(existing) === canonicalImportValue(preset)) continue
    const remappedId = stableImportedTradeId(payloadDigest, `review-pool:${preset.id}`)
    if (!merged.has(remappedId)) merged.set(remappedId, { ...preset, id: remappedId })
  }
  return [...merged.values()]
}

function mergeStrategies(current: Strategy[], imported: Strategy[]): Strategy[] {
  const map = new Map(current.map((strategy) => [strategy.id, strategy]))
  for (const strategy of imported) map.set(strategy.id, strategy)
  return Array.from(map.values())
}

type StageOwned = { liveStageId?: string | null }

function validateImportedStageReferences(payload: ExportPayload, localStages: readonly LiveStage[]): void {
  const localIds = new Set(localStages.map((stage) => stage.id))
  const entities: StageOwned[] = [
    ...payload.trades.filter((trade) => trade.tradeKind !== 'paper'),
    ...(payload.weeklyReviews ?? []),
    ...(payload.weeklyReviews ?? []).flatMap((review) => review.riskSnapshot?.policyVersions ?? []),
    ...(payload.weeklyReviews ?? []).flatMap((review) => review.riskSnapshot?.overrideEvents ?? []),
  ]
  for (const entity of entities) {
    if (typeof entity.liveStageId === 'string' && !localIds.has(entity.liveStageId)) {
      throw new Error(`导入记录引用了当前资料库不存在的实盘阶段：${entity.liveStageId}`)
    }
  }
}

function withoutPaperStage(trade: Trade): Trade {
  if (trade.tradeKind !== 'paper') return trade
  const { liveStageId: _liveStageId, ...paper } = trade as Trade & { liveStageId?: unknown }
  return paper as Trade
}

function assignImportOwnership(
  current: PersistedSlice,
  payload: ExportPayload,
): ExportPayload {
  const currentStageId = getCurrentLiveStage(current.liveStages, current.currentLiveStageId).id
  if (payload.version >= 12) validateImportedStageReferences(payload, current.liveStages)
  const localStageIds = new Set(current.liveStages.map((stage) => stage.id))

  const accountTrades = payload.trades.map((trade): Trade => {
    if (trade.tradeKind === 'paper') return withoutPaperStage(trade)
    if (trade.tradeKind === 'case') return trade
    return { ...trade, liveStageId: currentStageId }
  })
  const sourcesById = new Map([...current.trades, ...accountTrades].map((trade) => [trade.id, trade]))
  const trades = accountTrades.map((trade): Trade => {
    if (trade.tradeKind !== 'case') return trade
    const source = trade.sourceTradeId ? sourcesById.get(trade.sourceTradeId) : undefined
    const inherited = source?.tradeKind === 'paper'
      ? currentStageId
      : source && source.liveStageId !== undefined
        ? source.liveStageId
        : currentStageId
    return { ...trade, liveStageId: inherited }
  })
  const own = <T extends StageOwned>(entity: T): T => ({ ...entity, liveStageId: currentStageId })
  const historicalRiskOnly = <T extends StageOwned>(
    entities: readonly T[],
  ): Array<T & { liveStageId: string }> => entities
    .filter((entity): entity is T & { liveStageId: string } =>
      typeof entity.liveStageId === 'string' &&
      entity.liveStageId !== currentStageId &&
      localStageIds.has(entity.liveStageId),
    )
    .map((entity) => ({ ...entity }))
  const riskPolicyVersions = historicalRiskOnly(payload.riskPolicyVersions)
    .filter(isUsableRiskPolicy)
  const policiesById = new Map(
    [...(current.riskPolicyVersions ?? []), ...riskPolicyVersions]
      .map((policy) => [policy.id, policy]),
  )
  const hasPolicyInStage = (policyId: string, liveStageId: string): boolean => {
    const policy = policiesById.get(policyId)
    return Boolean(policy && policy.liveStageId === liveStageId && isUsableRiskPolicy(policy))
  }
  const weeklyRiskPreparations = historicalRiskOnly(payload.weeklyRiskPreparations)
    .filter((preparation) =>
      preparation.confirmedPolicyVersionId === null ||
      hasPolicyInStage(preparation.confirmedPolicyVersionId, preparation.liveStageId),
    )
  const monthlyRiskLimits = historicalRiskOnly(payload.monthlyRiskLimits)
    .filter((limit) => hasPolicyInStage(limit.sourcePolicyVersionId, limit.liveStageId))
  const importedTradeIds = new Set(payload.trades.map((trade) => trade.id))
  const localTradesById = new Map(current.trades.map((trade) => [trade.id, trade]))
  const riskOverrideEvents = historicalRiskOnly(payload.riskOverrideEvents)
    .filter((event) => {
      if (importedTradeIds.has(event.tradeId)) return false
      const trade = localTradesById.get(event.tradeId)
      if (
        trade?.tradeKind !== 'live' ||
        trade.liveStageId !== event.liveStageId ||
        trade.ref !== event.tradeIdentityAtDecision.ref ||
        trade.symbol !== event.tradeIdentityAtDecision.symbol
      ) return false
      return event.policyVersionId === null ||
        hasPolicyInStage(event.policyVersionId, event.liveStageId)
    })
  const skippedRiskCount = payload.weeklyRiskPreparations.length +
    payload.riskPolicyVersions.length +
    payload.monthlyRiskLimits.length +
    payload.riskOverrideEvents.length -
    weeklyRiskPreparations.length -
    riskPolicyVersions.length -
    monthlyRiskLimits.length -
    riskOverrideEvents.length
  if (skippedRiskCount > 0) {
    console.warn(`导入已跳过 ${skippedRiskCount} 条无法安全归入当前阶段的风险配置；请在本机重新确认风险设置。`)
  }
  return {
    ...payload,
    trades,
    weeklyRiskPreparations,
    riskPolicyVersions,
    monthlyRiskLimits,
    riskOverrideEvents,
    weeklyReviews: payload.weeklyReviews?.map((review) => ({
      ...own(review),
      riskSnapshot: review.riskSnapshot
        ? {
            ...review.riskSnapshot,
            policyVersions: (review.riskSnapshot.policyVersions ?? []).map(own),
            overrideEvents: (review.riskSnapshot.overrideEvents ?? []).map(own),
          }
        : undefined,
    })),
  }
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
  const ownedPayload = assignImportOwnership(current, payload)
  const ownedIdentityPayload = assignImportOwnership(current, {
    ...payload,
    trades: identityPayload.trades,
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
  })
  const combinedStrategies = mergeStrategies(current.strategies, ensureStrategies(ownedPayload.strategies))
  const { strategies, trades: migrated } = normalizeTradeStrategyReferences(
    ownedPayload.trades,
    combinedStrategies,
  )
  const identityTrades = normalizeTradeStrategyReferences(
    ownedIdentityPayload.trades,
    combinedStrategies,
  ).trades
  const riskMerged = mergeRiskImport(
    current,
    {
      ...ownedPayload,
      trades: migrated,
      strategies,
      liveStages: current.liveStages,
      currentLiveStageId: current.currentLiveStageId,
      scheduledStageRollover: current.scheduledStageRollover,
    },
    payloadDigest,
    identityTrades,
  )
  const templatesById = new Map(
    normalizeReviewTemplates(current.reviewTemplates ?? []).map((template) => [template.id, template]),
  )
  for (const template of ownedPayload.reviewTemplates === undefined
    ? []
    : normalizeReviewTemplates(ownedPayload.reviewTemplates)) {
    if (!templatesById.has(template.id)) templatesById.set(template.id, template)
  }
  const reviewPoolPresets = mergeReviewPoolPresets(
    current.reviewPoolPresets ?? [],
    ownedPayload.reviewPoolPresets ?? [],
    payloadDigest,
  )
  return {
    strategies,
    trades: normalizeTrades(riskMerged.trades),
    liveStages: current.liveStages.map((stage) => ({ ...stage })),
    currentLiveStageId: current.currentLiveStageId,
    scheduledStageRollover: current.scheduledStageRollover
      ? { ...current.scheduledStageRollover }
      : current.scheduledStageRollover,
    weeklyRiskPreparations: riskMerged.weeklyRiskPreparations,
    riskPolicyVersions: riskMerged.riskPolicyVersions,
    monthlyRiskLimits: riskMerged.monthlyRiskLimits,
    riskOverrideEvents: riskMerged.riskOverrideEvents,
    weeklyReviews: riskMerged.weeklyReviews,
    quickNotes: mergeQuickNotes(current.quickNotes ?? [], ownedPayload.quickNotes ?? []),
    starredIds: riskMerged.starredIds,
    subscribedIds: riskMerged.subscribedIds,
    pinnedStrategyIds: [...new Set([...current.pinnedStrategyIds, ...ownedPayload.pinnedStrategyIds])],
    display: normalizeDisplay({
      ...current.display,
      ...ownedPayload.display,
      tradingDayStartHour: current.display.tradingDayStartHour,
    }),
    tagPresets: mergeTagPresets(current.tagPresets ?? [], ownedPayload.tagPresets ?? []),
    mistakeTagPresets: mergeTagPresets(
      current.mistakeTagPresets ?? [],
      ownedPayload.mistakeTagPresets ?? [],
    ),
    savedTradeViews: mergeSavedTradeViews(
      current.savedTradeViews ?? [],
      ownedPayload.savedTradeViews ?? [],
    ),
    symbolIcons: mergeSymbolIcons(current.symbolIcons ?? {}, ownedPayload.symbolIcons ?? {}),
    symbolCatalog: mergeSymbolCatalog(
      current.symbolCatalog ?? [],
      ownedPayload.symbolCatalog ?? [],
    ),
    reviewTemplates: Array.from(templatesById.values()),
    reviewPoolPresets,
    // 合并导入保留当前首页布局；新导入的自定义池默认进入“更多复盘池”。
    reviewPoolLayout: current.reviewPoolLayout,
  }
}
