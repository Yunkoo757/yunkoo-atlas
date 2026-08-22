import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import type { RiskOverrideEvent } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import type { PersistedSlice } from '@/lib/importTypes'
import { OperationalError } from '@/lib/operationalError'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  const canonicalize = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(canonicalize)
    if (!isRecord(nested)) return nested
    return Object.fromEntries(
      Object.keys(nested)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
        .filter((key) => nested[key] !== undefined)
        .map((key) => [key, canonicalize(nested[key])]),
    )
  }
  return JSON.stringify(canonicalize(value))
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function stableImportedTradeId(payloadDigest: string, tradeId: string): string {
  return `imported:${stableHash(`${payloadDigest}:${tradeId}`)}`
}

function stableTradeIdentity(trade: Trade): Record<string, string> | null {
  const create = trade.activities
    ?.filter((activity) =>
      activity.kind === 'create' && activity.id && Number.isFinite(Date.parse(activity.timestamp)),
    )
    .sort((left, right) => {
      const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp)
      return timestampOrder || left.id.localeCompare(right.id)
    })[0]
  if (!trade.id || !trade.ref || !trade.tradeKind || !create) return null
  return {
    id: trade.id,
    ref: trade.ref,
    tradeKind: trade.tradeKind,
    earliestCreateActivityId: create.id,
    earliestCreateActivityTimestamp: create.timestamp,
  }
}

export function isSameTradeIdentity(left: Trade, right: Trade): boolean {
  const leftIdentity = stableTradeIdentity(left)
  const rightIdentity = stableTradeIdentity(right)
  if (leftIdentity && rightIdentity) return canonicalJson(leftIdentity) === canonicalJson(rightIdentity)
  return canonicalJson(left) === canonicalJson(right)
}

function mergeImmutableById<T extends { id: string }>(
  current: T[],
  imported: T[],
  label: string,
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of imported) {
    const local = byId.get(item.id)
    if (!local) {
      byId.set(item.id, item)
      continue
    }
    if (canonicalJson(local) !== canonicalJson(item)) {
      throw new OperationalError(
        'import-immutable-entity-conflict',
        `导入冲突：${label} ${item.id} 与当前资料库中的同 ID 记录内容不同。`,
      )
    }
  }
  return [...byId.values()]
}

function mergeWeeklyPreparations(
  current: NonNullable<PersistedSlice['weeklyRiskPreparations']>,
  imported: NonNullable<PersistedSlice['weeklyRiskPreparations']>,
): NonNullable<PersistedSlice['weeklyRiskPreparations']> {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of imported) {
    const local = byId.get(item.id)
    if (!local || Date.parse(item.updatedAt) > Date.parse(local.updatedAt)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

function weeklyReviewStageWeekKey(
  review: NonNullable<PersistedSlice['weeklyReviews']>[number],
): string {
  return `${review.liveStageId ?? 'legacy'}:${review.weekStart}`
}

function completedReviewFrozenTuple(
  review: NonNullable<PersistedSlice['weeklyReviews']>[number],
): unknown {
  return {
    metricsSnapshot: review.metricsSnapshot,
    evidenceSnapshot: review.evidenceSnapshot,
    riskSnapshot: review.riskSnapshot,
    completedAt: review.completedAt,
  }
}

function mergeWeeklyReviews(
  current: NonNullable<PersistedSlice['weeklyReviews']>,
  imported: NonNullable<PersistedSlice['weeklyReviews']>,
): NonNullable<PersistedSlice['weeklyReviews']> {
  const byStageWeek = new Map(
    normalizeWeeklyReviews(current).map((review) => [weeklyReviewStageWeekKey(review), review]),
  )
  for (const importedReview of normalizeWeeklyReviews(imported)) {
    const key = weeklyReviewStageWeekKey(importedReview)
    const local = byStageWeek.get(key)
    if (!local) {
      byStageWeek.set(key, importedReview)
      continue
    }
    if (local.status === 'completed') {
      if (
        importedReview.status === 'completed' &&
        canonicalJson(completedReviewFrozenTuple(local)) !== canonicalJson(completedReviewFrozenTuple(importedReview))
      ) {
        throw new OperationalError(
          'import-immutable-entity-conflict',
          `导入冲突：已完成周复盘 ${local.id} 的冻结事实与导入记录不同。请先显式重开本地复盘再合并。`,
        )
      }
      const editableSource = Date.parse(importedReview.updatedAt) > Date.parse(local.updatedAt)
        ? importedReview
        : local
      byStageWeek.set(key, {
        ...editableSource,
        id: local.id,
        liveStageId: local.liveStageId,
        weekStart: local.weekStart,
        weekEnd: local.weekEnd,
        status: local.status,
        metricsSnapshot: local.metricsSnapshot,
        evidenceSnapshot: local.evidenceSnapshot,
        riskSnapshot: local.riskSnapshot,
        createdAt: local.createdAt,
        completedAt: local.completedAt,
      })
      continue
    }
    if (Date.parse(importedReview.updatedAt) > Date.parse(local.updatedAt)) {
      byStageWeek.set(key, importedReview)
    }
  }
  return normalizeWeeklyReviews([...byStageWeek.values()])
}

function identitySummary(trade: Trade): RiskOverrideEvent['tradeIdentityAtDecision'] | null {
  if (trade.tradeKind !== 'live') return null
  return { ref: trade.ref, symbol: trade.symbol, tradeKind: 'live' }
}

function rewriteEvent(
  event: RiskOverrideEvent,
  idMap: ReadonlyMap<string, string>,
  tradesById: ReadonlyMap<string, Trade>,
): RiskOverrideEvent {
  const mappedId = idMap.get(event.tradeId)
  const target = tradesById.get(mappedId ?? event.tradeId)
  const targetIdentity = target && identitySummary(target)
  const canResolveUnmapped = !mappedId && targetIdentity &&
    canonicalJson(targetIdentity) === canonicalJson(event.tradeIdentityAtDecision)
  if (!targetIdentity || (!mappedId && !canResolveUnmapped)) {
    return { ...event, linkState: 'unresolved' }
  }
  return {
    ...event,
    tradeId: mappedId ?? event.tradeId,
    tradeIdentityAtDecision: targetIdentity,
    linkState: 'resolved',
  }
}

function rewriteTradeReferences(
  imported: PersistedSlice,
  idMap: ReadonlyMap<string, string>,
  currentTrades: readonly Trade[],
): PersistedSlice {
  const rewrittenTrades = imported.trades.map((trade) => {
    const sourceTradeId = trade.sourceTradeId === undefined
      ? undefined
      : idMap.get(trade.sourceTradeId) ?? trade.sourceTradeId
    return {
      ...trade,
      id: idMap.get(trade.id) ?? trade.id,
      ...(trade.sourceTradeId === undefined ? {} : { sourceTradeId }),
    }
  })
  const tradesById = new Map([...currentTrades, ...rewrittenTrades].map((trade) => [trade.id, trade]))
  const rewriteIds = (ids: string[]): string[] => ids.map((id) => idMap.get(id) ?? id)
  const rewriteEvidenceTrades = <T extends { id: string }>(trades: T[]): T[] =>
    trades.map((trade) => ({ ...trade, id: idMap.get(trade.id) ?? trade.id }))
  const rewriteEvents = (events: RiskOverrideEvent[]): RiskOverrideEvent[] =>
    events.map((event) => rewriteEvent(event, idMap, tradesById))
  return {
    ...imported,
    trades: rewrittenTrades,
    riskOverrideEvents: rewriteEvents(imported.riskOverrideEvents ?? []),
    weeklyReviews: imported.weeklyReviews?.map((review) => ({
      ...review,
      highlightTradeIds: rewriteIds(review.highlightTradeIds),
      mistakeTradeIds: rewriteIds(review.mistakeTradeIds),
      followUpTradeIds: rewriteIds(review.followUpTradeIds),
      evidenceSnapshot: review.evidenceSnapshot
        ? {
            ...review.evidenceSnapshot,
            trades: rewriteEvidenceTrades(review.evidenceSnapshot.trades),
            missedTrades: rewriteEvidenceTrades(review.evidenceSnapshot.missedTrades),
          }
        : undefined,
      riskSnapshot: review.riskSnapshot
        ? { ...review.riskSnapshot, overrideEvents: rewriteEvents(review.riskSnapshot.overrideEvents) }
        : undefined,
    })),
    starredIds: rewriteIds(imported.starredIds),
    subscribedIds: rewriteIds(imported.subscribedIds),
  }
}

export function mergeRiskImport(
  current: PersistedSlice,
  imported: PersistedSlice,
  payloadDigest: string,
  identityTrades: readonly Trade[] = imported.trades,
): PersistedSlice {
  const currentById = new Map(current.trades.map((trade) => [trade.id, trade]))
  const identityById = new Map(identityTrades.map((trade) => [trade.id, trade]))
  const idMap = new Map<string, string>()
  for (const trade of imported.trades) {
    const local = currentById.get(trade.id)
    const identityTrade = identityById.get(trade.id) ?? trade
    const mappedId = local && !isSameTradeIdentity(local, identityTrade)
      ? stableImportedTradeId(payloadDigest, trade.id)
      : trade.id
    const mappedOccupant = mappedId === trade.id ? undefined : currentById.get(mappedId)
    if (
      mappedOccupant &&
      !isSameTradeIdentity(mappedOccupant, { ...identityTrade, id: mappedId })
    ) {
      throw new Error(`导入冲突：稳定导入交易 ID ${mappedId} 已被其他交易占用。`)
    }
    idMap.set(
      trade.id,
      mappedId,
    )
  }

  const rewritten = rewriteTradeReferences(imported, idMap, current.trades)
  const tradesById = new Map(current.trades.map((trade) => [trade.id, trade]))
  for (const trade of rewritten.trades) {
    const originalId = imported.trades.find((item) => idMap.get(item.id) === trade.id)?.id
    const isStableRepeat = originalId !== undefined && originalId !== trade.id && tradesById.has(trade.id)
    if (!isStableRepeat) tradesById.set(trade.id, trade)
  }

  return {
    ...current,
    trades: [...tradesById.values()],
    weeklyRiskPreparations: mergeWeeklyPreparations(
      current.weeklyRiskPreparations ?? [],
      rewritten.weeklyRiskPreparations ?? [],
    ),
    riskPolicyVersions: mergeImmutableById(
      current.riskPolicyVersions ?? [],
      rewritten.riskPolicyVersions ?? [],
      '风险策略版本',
    ),
    monthlyRiskLimits: mergeImmutableById(
      current.monthlyRiskLimits ?? [],
      rewritten.monthlyRiskLimits ?? [],
      '月度风险限额',
    ),
    riskOverrideEvents: mergeImmutableById(
      current.riskOverrideEvents ?? [],
      rewritten.riskOverrideEvents ?? [],
      '风险覆盖事件',
    ),
    weeklyReviews: mergeWeeklyReviews(
      current.weeklyReviews ?? [],
      rewritten.weeklyReviews ?? [],
    ),
    starredIds: [...new Set([...current.starredIds, ...rewritten.starredIds])],
    subscribedIds: [...new Set([...current.subscribedIds, ...rewritten.subscribedIds])],
  }
}
