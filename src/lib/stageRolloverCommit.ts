import type { ScheduledStageRollover } from '@/lib/liveStages'
import {
  buildStageRolloverCandidate,
  inspectDueStageRollover,
  postponeStageRollover,
  type StageRolloverCandidate,
  type StageRolloverState,
} from '@/lib/stageRollover'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import type { PersistedSnapshot } from '@/storage/types'
import type {
  StageRolloverCommitInput,
  StageRolloverCommitResult,
} from '@/types/journalBridge'

export const STAGE_MANAGEMENT_OPEN_EVENT = 'atlas:stage-management-open'

export function notifyStageManagementOpened(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STAGE_MANAGEMENT_OPEN_EVENT))
}

export interface StageRolloverCapture {
  state: StageRolloverState
  snapshot: PersistedSnapshot
  currentTradingDayKey: string
  now: string
  nextStageId: string
}

export interface ExecuteDueStageRolloverDependencies {
  captureLatest(): StageRolloverCapture
  flushBeforeCommit(): Promise<void>
  commitDurably(input: StageRolloverCommitInput): Promise<StageRolloverCommitResult>
  publish(candidate: StageRolloverCandidate): void
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

function candidateSnapshot(
  snapshot: PersistedSnapshot,
  candidate: StageRolloverCandidate,
): PersistedSnapshot {
  const current = candidate.liveStages.find((stage) => stage.id === candidate.currentLiveStageId)
  if (!current) throw new Error('阶段切换候选缺少当前阶段')
  return {
    ...snapshot,
    liveStages: candidate.liveStages,
    currentLiveStageId: candidate.currentLiveStageId,
    scheduledStageRollover: candidate.scheduledStageRollover,
    trades: [...candidate.trades],
    weeklyReviews: [...candidate.weeklyReviews],
    riskPolicyVersions: [...candidate.riskPolicyVersions],
    liveStatsStartTradingDayKey: current.startsOn,
    livePerformanceCycles: [{
      id: `legacy-stage-${current.sequence}`,
      name: current.name,
      startTradingDayKey: current.startsOn,
      createdAt: current.createdAt,
    }],
  }
}

/**
 * Renderer 只负责准备候选并在耐久提交成功后发布；备份与文件写入只能由主进程完成。
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

    let candidate: StageRolloverCandidate
    let snapshot: PersistedSnapshot
    try {
      candidate = buildStageRolloverCandidate(latest.state, {
        effectiveWeekStart: inspection.scheduled.effectiveWeekStart,
        now: latest.now,
        nextStageId: latest.nextStageId,
      })
      snapshot = candidateSnapshot(latest.snapshot, candidate)
    } catch {
      return { kind: 'failed', reason: 'validation-failed', message: '阶段切换候选无效' }
    }

    let committed: StageRolloverCommitResult
    try {
      committed = await dependencies.commitDurably({
        expectedCurrentStageId: latest.state.currentLiveStageId,
        expectedRolloverId: inspection.scheduled.id,
        snapshot,
      })
    } catch {
      return { kind: 'failed', reason: 'write-failed', message: '阶段切换提交失败' }
    }
    if (!committed.ok) return { kind: 'failed', reason: committed.reason, message: committed.message }
    dependencies.publish(candidate)
    return { kind: 'committed' }
  } finally {
    unlock()
  }
}
