import type { PersistedSnapshot } from '@/storage/types'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { createInitialLiveStage } from '@/lib/liveStages'

export interface DataOrganizationRequest {
  migrateLive: boolean
  resetStages: boolean
  deleteWeeklyIds: string[]
}

/** A complete candidate: no store mutation and no attachment deletion. */
export function prepareDataOrganization(
  before: PersistedSnapshot,
  request: DataOrganizationRequest,
  day: string,
  now: string,
  stageId: string,
): PersistedSnapshot {
  assertValidPersistedSnapshot(before)
  const next = structuredClone(before)
  const liveIds = new Set(before.trades.filter(t => t.tradeKind === 'live').map(t => t.id))
  if (request.resetStages && !request.migrateLive && liveIds.size) {
    throw new Error('仍有实盘日志，请先迁移到模拟盘，或同时勾选迁移。')
  }
  const deleted = new Set(request.deleteWeeklyIds)
  if ([...deleted].some(id => !before.weeklyReviews?.some(review => review.id === id))) {
    throw new Error('周复盘列表已变化，请重新确认。')
  }
  next.weeklyReviews = (next.weeklyReviews ?? []).filter(review => !deleted.has(review.id))
  if (request.migrateLive) {
    next.trades = next.trades.map(trade => {
      if (trade.tradeKind !== 'live') return trade
      const { liveStageId: _stage, ...fields } = trade
      return { ...fields, tradeKind: 'paper' }
    })
    for (const review of next.weeklyReviews) {
      const frozen = new Set([
        ...(review.evidenceSnapshot?.trades.map(t => t.id) ?? []),
        ...(review.evidenceSnapshot?.missedTrades.map(t => t.id) ?? []),
        ...(review.riskSnapshot?.overrideEvents.map(t => t.tradeId) ?? []),
      ])
      for (const key of ['highlightTradeIds', 'mistakeTradeIds', 'followUpTradeIds'] as const) {
        review[key] = review[key].filter(id => !liveIds.has(id) || frozen.has(id))
      }
    }
  }
  if (request.resetStages) {
    const stage = createInitialLiveStage(day, now, stageId)
    next.liveStages = [stage]
    next.currentLiveStageId = stage.id
    next.scheduledStageRollover = null
    for (const trade of next.trades) if (trade.tradeKind === 'case') trade.liveStageId = null
    // Retained reviews keep their frozen evidence but no longer belong to a deleted stage.
    for (const review of next.weeklyReviews) {
      review.liveStageId = null
      for (const policy of review.riskSnapshot?.policyVersions ?? []) policy.liveStageId = null
      for (const event of review.riskSnapshot?.overrideEvents ?? []) event.liveStageId = null
    }
    const weeks = next.weeklyReviews.map(review => review.weekStart)
    if (new Set(weeks).size !== weeks.length) {
      throw new Error('不同旧阶段存在同一周的复盘，请先选择删除重复周复盘，再清空阶段。')
    }
    next.weeklyRiskPreparations = []
    next.riskPolicyVersions = []
    next.monthlyRiskLimits = []
    next.riskOverrideEvents = []
  }
  assertValidPersistedSnapshot(next)
  return next
}

export interface OrganizationBoundary {
  lock(): () => void
  flush(): Promise<void>
  capture(): PersistedSnapshot
  suspend(): void
  resume(): void
  backup(): Promise<string>
  persist(snapshot: PersistedSnapshot): Promise<void>
  publish(snapshot: PersistedSnapshot): void
  halt(message: string): void
}

/** Publish only after durable commit. A failed/uncertain commit must never autosave the old state. */
export async function commitDataOrganization(
  expected: string,
  makeCandidate: (snapshot: PersistedSnapshot) => PersistedSnapshot,
  boundary: OrganizationBoundary,
): Promise<string> {
  const unlock = boundary.lock()
  let suspended = false
  let commitStarted = false
  try {
    await boundary.flush()
    const before = boundary.capture()
    if (JSON.stringify(before) !== expected) throw new Error('资料已变化，请重新预览后确认，尚未执行整理。')
    const candidate = makeCandidate(before)
    if (JSON.stringify(candidate) === expected) throw new Error('没有需要整理的数据。')
    boundary.suspend(); suspended = true
    const backup = await boundary.backup()
    if (JSON.stringify(boundary.capture()) !== expected) throw new Error('备份期间资料已变化，已取消整理。')
    commitStarted = true
    await boundary.persist(candidate)
    if (JSON.stringify(boundary.capture()) !== expected) throw new Error('提交期间内存资料发生变化，已停止保存，请重新打开资料库确认。')
    boundary.publish(candidate)
    commitStarted = false
    return backup
  } catch (error) {
    if (commitStarted) boundary.halt('数据整理提交未能安全完成，已停止自动保存。请重新打开资料库确认状态，必要时从整理前备份恢复。')
    throw error
  } finally {
    try { if (suspended) boundary.resume() } finally { unlock() }
  }
}
