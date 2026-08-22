import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import {
  inspectDueStageRollover,
  postponeStageRollover,
  type StageRolloverState,
} from '@/lib/stageRollover'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import type { PersistedSnapshot } from '@/storage/types'
import type {
  StageRolloverCommitInput,
  StageRolloverCommitResult,
  StageRolloverPublishState,
} from '@/types/journalBridge'

export const STAGE_MANAGEMENT_OPEN_EVENT = 'atlas:stage-management-open'

export function notifyStageManagementOpened(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STAGE_MANAGEMENT_OPEN_EVENT))
}

export interface StageRolloverCapture {
  state: StageRolloverState
  currentTradingDayKey: string
}

export interface ExecuteDueStageRolloverDependencies {
  captureLatest(): StageRolloverCapture
  flushBeforeCommit(): Promise<void>
  commitDurably(input: StageRolloverCommitInput): Promise<StageRolloverCommitResult>
  publish(state: StageRolloverPublishState): Promise<void> | void
  postpone(scheduled: ScheduledStageRollover): Promise<void>
  lockInteraction?: () => () => void
}

export type StageRolloverExecutionResult =
  | { kind: 'not-scheduled' }
  | { kind: 'not-due' }
  | { kind: 'postponed'; blockers: string[] }
  | { kind: 'committed' }
  | {
      kind: 'failed'
      reason: Exclude<StageRolloverCommitResult, { ok: true }>['reason']
      message: string
    }

export interface ReconcileCommittedStageRolloverDependencies {
  reloadAuthoritativeSnapshot(): Promise<PersistedSnapshot | null>
  publishDurableSnapshot(
    snapshot: PersistedSnapshot,
    publish: StageRolloverPublishState,
  ): Promise<void> | void
}

function sameStage(left: LiveStage, right: LiveStage): boolean {
  return left.id === right.id &&
    left.sequence === right.sequence &&
    left.name === right.name &&
    left.status === right.status &&
    left.startsOn === right.startsOn &&
    left.endsOn === right.endsOn &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt
}

function sameCycle(left: LivePerformanceCycle, right: LivePerformanceCycle): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    left.startTradingDayKey === right.startTradingDayKey &&
    left.createdAt === right.createdAt
}

function snapshotMatchesPublish(
  snapshot: PersistedSnapshot,
  publish: StageRolloverPublishState,
): boolean {
  const cycles = snapshot.livePerformanceCycles ?? []
  return snapshot.currentLiveStageId === publish.currentLiveStageId &&
    snapshot.scheduledStageRollover === null &&
    snapshot.liveStatsStartTradingDayKey === publish.liveStatsStartTradingDayKey &&
    snapshot.liveStages.length === publish.liveStages.length &&
    snapshot.liveStages.every((stage, index) => sameStage(stage, publish.liveStages[index]!)) &&
    cycles.length === publish.livePerformanceCycles.length &&
    cycles.every((cycle, index) => sameCycle(cycle, publish.livePerformanceCycles[index]!))
}

/**
 * durable ok 后重新读取完整权威快照，使 renderer 的非阶段字段也与主进程 reload 基线对齐。
 * 五个阶段字段必须与 commit 返回的安全 publish payload 完全一致。
 */
export async function reconcileCommittedStageRollover(
  publish: StageRolloverPublishState,
  dependencies: ReconcileCommittedStageRolloverDependencies,
): Promise<void> {
  const snapshot = await dependencies.reloadAuthoritativeSnapshot()
  if (!snapshot || !snapshotMatchesPublish(snapshot, publish)) {
    throw new Error('阶段切换后的权威状态无法确认')
  }
  await dependencies.publishDurableSnapshot(snapshot, publish)
}

/** 同一时刻只执行一次自动检查；完成后允许下一次业务周或管理入口触发。 */
export function createStageRolloverCheck(
  check: () => Promise<StageRolloverExecutionResult>,
): () => Promise<StageRolloverExecutionResult> {
  let inFlight: Promise<StageRolloverExecutionResult> | null = null
  return () => {
    if (inFlight) return inFlight
    let current!: Promise<StageRolloverExecutionResult>
    current = (async () => {
      try {
        return await check()
      } finally {
        if (inFlight === current) inFlight = null
      }
    })()
    inFlight = current
    return current
  }
}

/**
 * Renderer 只发送 stale 预期，并在耐久提交成功后发布主进程权威状态。
 */
export async function executeDueStageRollover(
  dependencies: ExecuteDueStageRolloverDependencies,
): Promise<StageRolloverExecutionResult> {
  const initial = dependencies.captureLatest()
  if (!initial.state.scheduledStageRollover) return { kind: 'not-scheduled' }
  if (inspectDueStageRollover(initial.state, initial.currentTradingDayKey).kind === 'not-due') {
    return { kind: 'not-due' }
  }

  const unlock = (dependencies.lockInteraction ?? lockStorageCutoverInteraction)()
  try {
    try {
      await dependencies.flushBeforeCommit()
    } catch {
      return { kind: 'failed', reason: 'write-failed', message: '切换前资料保存失败' }
    }

    const latest = dependencies.captureLatest()
    if (!latest.state.scheduledStageRollover) return { kind: 'not-scheduled' }
    const inspection = inspectDueStageRollover(latest.state, latest.currentTradingDayKey)
    if (inspection.kind === 'not-due') return { kind: 'not-due' }
    if (inspection.kind === 'blocked') {
      const postponed = postponeStageRollover(inspection.scheduled, latest.currentTradingDayKey)
      try {
        await dependencies.postpone(postponed)
      } catch {
        return { kind: 'failed', reason: 'write-failed', message: '阶段切换顺延保存失败' }
      }
      return { kind: 'postponed', blockers: inspection.blockers.map((item) => item.code) }
    }

    let committed: StageRolloverCommitResult
    try {
      committed = await dependencies.commitDurably({
        expectedCurrentStageId: latest.state.currentLiveStageId,
        expectedRollover: { ...inspection.scheduled },
      })
    } catch {
      return { kind: 'failed', reason: 'write-failed', message: '阶段切换提交失败' }
    }
    if (!committed.ok) return { kind: 'failed', reason: committed.reason, message: committed.message }
    try {
      await dependencies.publish(committed.publish)
    } catch {
      return { kind: 'failed', reason: 'write-failed', message: '阶段已保存，界面刷新失败，请重新打开应用' }
    }
    return { kind: 'committed' }
  } finally {
    unlock()
  }
}
