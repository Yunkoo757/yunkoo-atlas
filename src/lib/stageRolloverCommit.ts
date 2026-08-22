import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
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
export const STAGE_ROLLOVER_RECOVERY_REQUIRED_EVENT = 'atlas:stage-rollover-recovery-required'

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
  recoverAfterCommitError?(input: StageRolloverCommitInput): Promise<StageRolloverCommitResult>
  publish(state: StageRolloverPublishState): Promise<void> | void
  postpone(scheduled: ScheduledStageRollover): Promise<void>
  enterRecoveryRequired?(message: string): void
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

function snapshotMatchesPublish(
  snapshot: PersistedSnapshot,
  publish: StageRolloverPublishState,
): boolean {
  return snapshot.currentLiveStageId === publish.currentLiveStageId &&
    snapshot.scheduledStageRollover === null &&
    snapshot.liveStages.length === publish.liveStages.length &&
    snapshot.liveStages.every((stage, index) => sameStage(stage, publish.liveStages[index]!))
}

function previousCalendarDay(day: string): string {
  const instant = new Date(`${day}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() - 1)
  return instant.toISOString().slice(0, 10)
}

/**
 * IPC 回包丢失时只接受两种完整磁盘真相：原预约完全未变（可重试），或
 * 原阶段已按预约边界归档且新 current 已落盘（可发布）。其他组合必须停写恢复。
 */
export function classifyUncertainStageRolloverSnapshot(
  input: StageRolloverCommitInput,
  snapshot: PersistedSnapshot | null,
): StageRolloverCommitResult {
  if (!snapshot) {
    return {
      ok: false,
      reason: 'recovery-required',
      message: '无法确认阶段写入结果，已停止继续保存，请重新打开应用检查资料库',
    }
  }
  const scheduled = snapshot.scheduledStageRollover
  if (
    snapshot.currentLiveStageId === input.expectedCurrentStageId
    && scheduled?.id === input.expectedRollover.id
    && scheduled.requestedAt === input.expectedRollover.requestedAt
    && scheduled.effectiveWeekStart === input.expectedRollover.effectiveWeekStart
    && scheduled.postponedCount === input.expectedRollover.postponedCount
  ) {
    return { ok: false, reason: 'write-failed', message: '阶段切换尚未写入，可安全重试' }
  }

  const previous = snapshot.liveStages.find((stage) => stage.id === input.expectedCurrentStageId)
  const current = snapshot.liveStages.find((stage) => stage.id === snapshot.currentLiveStageId)
  if (
    scheduled === null
    && previous?.status === 'archived'
    && previous.endsOn === previousCalendarDay(input.expectedRollover.effectiveWeekStart)
    && current?.status === 'current'
    && current.id !== input.expectedCurrentStageId
    && current.startsOn === input.expectedRollover.effectiveWeekStart
    && current.sequence > previous.sequence
  ) {
    return {
      ok: true,
      publish: {
        liveStages: snapshot.liveStages,
        currentLiveStageId: snapshot.currentLiveStageId,
        scheduledStageRollover: null,
      },
    }
  }

  return {
    ok: false,
    reason: 'recovery-required',
    message: '阶段写入结果无法确认，已停止继续保存，请重新打开应用检查资料库',
  }
}

/**
 * durable ok 后重新读取完整权威快照，使 renderer 的非阶段字段也与主进程 reload 基线对齐。
 * 三个阶段字段必须与 commit 返回的安全 publish payload 完全一致。
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

    const commitInput: StageRolloverCommitInput = {
      expectedCurrentStageId: latest.state.currentLiveStageId,
      expectedRollover: { ...inspection.scheduled },
    }
    let committed: StageRolloverCommitResult
    try {
      committed = await dependencies.commitDurably(commitInput)
    } catch {
      if (!dependencies.recoverAfterCommitError) {
        return { kind: 'failed', reason: 'write-failed', message: '阶段切换提交失败' }
      }
      try {
        committed = await dependencies.recoverAfterCommitError(commitInput)
      } catch {
        const message = '无法重新读取阶段写入结果，已停止继续保存，请重新打开应用检查资料库'
        dependencies.enterRecoveryRequired?.(message)
        return {
          kind: 'failed',
          reason: 'recovery-required',
          message,
        }
      }
    }
    if (!committed.ok) {
      if (committed.reason === 'recovery-required') {
        dependencies.enterRecoveryRequired?.(committed.message)
      }
      return { kind: 'failed', reason: committed.reason, message: committed.message }
    }
    try {
      await dependencies.publish(committed.publish)
    } catch {
      const message = '阶段已保存，但界面无法与磁盘真相对齐；已停止继续保存，请重新加载应用'
      dependencies.enterRecoveryRequired?.(message)
      return { kind: 'failed', reason: 'recovery-required', message }
    }
    return { kind: 'committed' }
  } finally {
    unlock()
  }
}
