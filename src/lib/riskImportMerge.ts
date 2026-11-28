import { resolveImportedTrades, type VerifyImportAsset } from '@/lib/importTradeIdentity'
import { updateWeeklyReviewMarks } from '@/data/weeklyReviewTradeReferences'
import { canonicalJsonEqual } from '@/lib/riskFingerprint'
import { stripRetiredSnapshotDomains } from '@/storage/retiredSnapshotDomains'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import type { RiskOverrideEvent } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import type { ImportMergeResult, PersistedSlice } from '@/lib/importTypes'
import { OperationalError } from '@/lib/operationalError'

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
    if (!canonicalJsonEqual(local, item)) {
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
        !canonicalJsonEqual(completedReviewFrozenTuple(local), completedReviewFrozenTuple(importedReview))
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
    canonicalJsonEqual(targetIdentity, event.tradeIdentityAtDecision)
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
  const tradesById = new Map([...currentTrades, ...imported.trades].map((trade) => [trade.id, trade]))
  const rewriteIds = (ids: string[]): string[] => ids.map((id) => idMap.get(id) ?? id)
  const rewriteEvidenceTrades = <T extends { id: string }>(trades: T[]): T[] =>
    trades.map((trade) => ({ ...trade, id: idMap.get(trade.id) ?? trade.id }))
  const rewriteEvents = (events: RiskOverrideEvent[]): RiskOverrideEvent[] =>
    events.map((event) => rewriteEvent(event, idMap, tradesById))
  return {
    ...imported,
    riskOverrideEvents: rewriteEvents(imported.riskOverrideEvents ?? []),
    weeklyReviews: imported.weeklyReviews?.map((review) => ({
      ...updateWeeklyReviewMarks(review, rewriteIds),
      ...(review.previousCommitment && {
        previousCommitment: { ...review.previousCommitment, evidence: rewriteEvidenceTrades(review.previousCommitment.evidence) },
      }),
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

export async function mergeRiskImport(
  current: PersistedSlice,
  imported: PersistedSlice,
  payloadDigest: string,
  verifyAsset?: VerifyImportAsset,
): Promise<ImportMergeResult> {
  const { tradeIds, rewritten: importedTrades, trades } = await resolveImportedTrades(
    current.trades, imported.trades, payloadDigest, verifyAsset,
  )
  const rewritten = rewriteTradeReferences({ ...imported, trades: importedTrades }, tradeIds, current.trades)
  const state = {
    ...stripRetiredSnapshotDomains(current),
    trades,
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
  return { state, tradeIds }
}
