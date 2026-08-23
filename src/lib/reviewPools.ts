import type { CaseType, Trade, TradeSide } from '@/data/trades'
import {
  getReviewSessionContent,
  hasEffectiveReviewContent,
  normalizeReviewStageSource,
  type ReviewStageContext,
  type ReviewStageSource,
} from '@/lib/reviewSession'

export type ReviewPoolSource = 'case' | 'live' | 'paper'
export type ReviewPoolResult = 'win' | 'loss' | 'breakeven' | 'missed'
export type SystemReviewPoolId = 'all' | 'cases' | 'losses' | 'wins' | 'missed' | 'boosted'

export interface ReviewPoolFilters {
  sources: ReviewPoolSource[]
  results: ReviewPoolResult[]
  caseTypes: CaseType[]
  strategyIds: string[]
  symbols: string[]
  sides: TradeSide[]
  tags: string[]
  mistakeTags: string[]
  requireContent: boolean
  stageSource?: ReviewStageSource
}

export interface ReviewPoolPreset {
  id: string
  name: string
  filters: ReviewPoolFilters
  createdAt: string
  updatedAt: string
}

export type ReviewPoolRef =
  | { kind: 'system'; id: SystemReviewPoolId }
  | { kind: 'custom'; id: string }

export interface ReviewPoolLayout {
  homeOrder: ReviewPoolRef[]
  hiddenSystemIds: Exclude<SystemReviewPoolId, 'all'>[]
}

export interface ReviewPoolCandidateContext {
  subscribedIds?: ReadonlySet<string>
  stageContext?: ReviewStageContext
}

export interface ReviewPoolCandidateIndex {
  system: Record<SystemReviewPoolId, Trade[]>
  custom: Map<string, Trade[]>
}

const SYSTEM_REVIEW_POOL_IDS: readonly SystemReviewPoolId[] = [
  'all',
  'cases',
  'losses',
  'wins',
  'missed',
  'boosted',
]

const HIDEABLE_SYSTEM_REVIEW_POOL_IDS = SYSTEM_REVIEW_POOL_IDS.filter(
  (id): id is Exclude<SystemReviewPoolId, 'all'> => id !== 'all',
)

export const DEFAULT_REVIEW_POOL_LAYOUT: ReviewPoolLayout = {
  homeOrder: SYSTEM_REVIEW_POOL_IDS.map((id) => ({ kind: 'system', id })),
  hiddenSystemIds: [],
}

function isSystemReviewPoolId(value: unknown): value is SystemReviewPoolId {
  return typeof value === 'string' && SYSTEM_REVIEW_POOL_IDS.includes(value as SystemReviewPoolId)
}

function isHideableSystemReviewPoolId(value: unknown): value is Exclude<SystemReviewPoolId, 'all'> {
  return typeof value === 'string' && HIDEABLE_SYSTEM_REVIEW_POOL_IDS.includes(
    value as Exclude<SystemReviewPoolId, 'all'>,
  )
}

function isGenerallyEligible(trade: Trade): boolean {
  if (trade.deletedAt) return false
  if (trade.tradeKind === 'case') return true
  return trade.status === 'win' || trade.status === 'loss' || trade.status === 'breakeven' || trade.status === 'missed'
}

function matchesAny<T>(actual: T, selected: readonly T[]): boolean {
  return selected.length === 0 || selected.includes(actual)
}

function overlaps(actual: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || selected.some((value) => actual.includes(value))
}

function matchesStageSource(
  trade: Trade,
  stageSource: ReviewStageSource | undefined,
  stageContext: ReviewStageContext | undefined,
): boolean {
  if (trade.tradeKind !== 'live' || stageSource === undefined || stageSource === 'current-and-history') return true
  if (!stageContext || typeof trade.liveStageId !== 'string') return false

  const normalized = normalizeReviewStageSource(stageSource, stageContext.liveStages)
  const stage = stageContext.liveStages.find((candidate) => candidate.id === trade.liveStageId)
  if (!stage) return false
  if (normalized === 'current') return stage.id === stageContext.currentLiveStageId
  if (normalized === 'all-history') {
    return stage.status === 'archived' && stage.id !== stageContext.currentLiveStageId
  }
  if (normalized === 'current-and-history') return true
  return normalized.stageIds.includes(stage.id)
}

export function buildSystemReviewPool(
  trades: readonly Trade[],
  poolId: SystemReviewPoolId,
  subscribedIds: ReadonlySet<string>,
): Trade[] {
  return trades.filter((trade) => {
    if (!isGenerallyEligible(trade)) return false
    switch (poolId) {
      case 'all':
        return true
      case 'cases':
        return trade.tradeKind === 'case'
      case 'losses':
        return trade.tradeKind !== 'case' && trade.status === 'loss'
      case 'wins':
        return trade.tradeKind !== 'case' && trade.status === 'win'
      case 'missed':
        return trade.status === 'missed' || (trade.tradeKind === 'case' && trade.caseType === 'missed')
      case 'boosted':
        return subscribedIds.has(trade.id)
    }
  })
}

export function buildCustomReviewPool(
  trades: readonly Trade[],
  filters: ReviewPoolFilters,
  context: ReviewPoolCandidateContext = {},
): Trade[] {
  return trades.filter((trade) => matchesCustomReviewPool(trade, filters, context))
}

function matchesCustomReviewPool(
  trade: Trade,
  filters: ReviewPoolFilters,
  context: ReviewPoolCandidateContext,
): boolean {
    if (!isGenerallyEligible(trade)) return false
    if (!matchesAny(trade.tradeKind, filters.sources)) return false
    if (!matchesAny(trade.status as ReviewPoolResult, filters.results)) return false
    if (filters.caseTypes.length > 0 && (
      trade.tradeKind !== 'case' || !trade.caseType || !filters.caseTypes.includes(trade.caseType)
    )) return false
    if (!matchesAny(trade.strategyId, filters.strategyIds)) return false
    if (!matchesAny(trade.symbol, filters.symbols)) return false
    if (!matchesAny(trade.side, filters.sides)) return false
    if (!overlaps(trade.tags, filters.tags)) return false
    if (!overlaps(trade.mistakeTags, filters.mistakeTags)) return false
    if (filters.requireContent && !hasEffectiveReviewContent(getReviewSessionContent(trade))) return false
    return matchesStageSource(trade, filters.stageSource, context.stageContext)
}

export function buildReviewPoolCandidateIndex(
  trades: readonly Trade[],
  presets: readonly ReviewPoolPreset[],
  context: ReviewPoolCandidateContext = {},
): ReviewPoolCandidateIndex {
  const system = Object.fromEntries(
    SYSTEM_REVIEW_POOL_IDS.map((id) => [id, [] as Trade[]]),
  ) as Record<SystemReviewPoolId, Trade[]>
  const custom = new Map(presets.map((preset) => [preset.id, [] as Trade[]]))
  const subscribedIds = context.subscribedIds ?? new Set<string>()

  for (const trade of trades) {
    if (!isGenerallyEligible(trade)) continue
    system.all.push(trade)
    if (trade.tradeKind === 'case') system.cases.push(trade)
    if (trade.tradeKind !== 'case' && trade.status === 'loss') system.losses.push(trade)
    if (trade.tradeKind !== 'case' && trade.status === 'win') system.wins.push(trade)
    if (trade.status === 'missed' || (trade.tradeKind === 'case' && trade.caseType === 'missed')) {
      system.missed.push(trade)
    }
    if (subscribedIds.has(trade.id)) system.boosted.push(trade)
    for (const preset of presets) {
      if (matchesCustomReviewPool(trade, preset.filters, context)) custom.get(preset.id)?.push(trade)
    }
  }
  return { system, custom }
}

export function normalizeReviewPoolLayout(
  layout: ReviewPoolLayout | null | undefined,
  customPoolIds: readonly string[],
): ReviewPoolLayout {
  if (!layout) {
    return {
      homeOrder: DEFAULT_REVIEW_POOL_LAYOUT.homeOrder.map((item) => ({ ...item })),
      hiddenSystemIds: [],
    }
  }

  const customIds = new Set(customPoolIds)
  const hiddenSystemIds = [...new Set(layout.hiddenSystemIds.filter(isHideableSystemReviewPoolId))]
  const hidden = new Set<SystemReviewPoolId>(hiddenSystemIds)
  const seen = new Set<string>()
  const homeOrder: ReviewPoolRef[] = []

  for (const item of Array.isArray(layout.homeOrder) ? layout.homeOrder : []) {
    if (!item || (item.kind !== 'system' && item.kind !== 'custom')) continue
    if (item.kind === 'system' && (!isSystemReviewPoolId(item.id) || hidden.has(item.id))) continue
    if (item.kind === 'custom' && (typeof item.id !== 'string' || !customIds.has(item.id))) continue
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    homeOrder.push(item)
  }

  const withoutAll = homeOrder.filter((item) => item.kind !== 'system' || item.id !== 'all')
  const normalizedHomeOrder: ReviewPoolRef[] = [{ kind: 'system', id: 'all' }, ...withoutAll]
  return {
    homeOrder: normalizedHomeOrder.slice(0, 6),
    hiddenSystemIds,
  }
}
