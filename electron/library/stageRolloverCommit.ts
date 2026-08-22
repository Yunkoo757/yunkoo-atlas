import { getTradingDayKey } from '../../src/lib/periods'
import {
  buildStageRolloverCandidate,
  inspectDueStageRollover,
  type StageRolloverState,
} from '../../src/lib/stageRollover'
import type { ScheduledStageRollover } from '../../src/lib/liveStages'
import type { PersistedSnapshot } from '../../src/storage/types'
import type {
  BackupVerificationResult,
  StageRolloverCommitInput,
  StageRolloverCommitResult,
  StageRolloverPublishState,
} from '../../src/types/journalBridge'

export interface StageRolloverCommitStorage {
  loadSnapshot(): PersistedSnapshot | null
  saveSnapshot(snapshot: PersistedSnapshot): void | {
    kind: 'committed' | 'committed-after-write-error'
  }
}

export interface StageRolloverCommitDependencies {
  runExclusive<T>(operation: () => Promise<T> | T): Promise<T>
  loadStorage(): Promise<StageRolloverCommitStorage>
  createBackup(storage: StageRolloverCommitStorage): string | null
  verifyBackup(
    storage: StageRolloverCommitStorage,
    backupReference: string,
  ): Promise<BackupVerificationResult>
  validateSnapshot(snapshot: PersistedSnapshot): void
  now(): Date
  createStageId(): string
  reportError(event: string, error: unknown): void
}

type CommitFailure = Exclude<StageRolloverCommitResult, { ok: true }>

function failure(reason: CommitFailure['reason'], message: string): CommitFailure {
  return { ok: false, reason, message }
}

function snapshotSaveErrorOutcome(error: unknown): 'previous-unchanged' | 'indeterminate' | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { name?: unknown; outcome?: unknown }
  if (candidate.name !== 'SnapshotSaveError') return null
  return candidate.outcome === 'previous-unchanged' || candidate.outcome === 'indeterminate'
    ? candidate.outcome
    : null
}

function sameSnapshot(left: PersistedSnapshot, right: PersistedSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}

function isScheduledRollover(value: unknown): value is ScheduledStageRollover {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return hasExactKeys(candidate, ['id', 'requestedAt', 'effectiveWeekStart', 'postponedCount']) &&
    typeof candidate.id === 'string' &&
    typeof candidate.requestedAt === 'string' &&
    typeof candidate.effectiveWeekStart === 'string' &&
    Number.isInteger(candidate.postponedCount) &&
    Number(candidate.postponedCount) >= 0
}

function isCommitInput(value: unknown): value is StageRolloverCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return hasExactKeys(candidate, ['expectedCurrentStageId', 'expectedRollover']) &&
    typeof candidate.expectedCurrentStageId === 'string' &&
    candidate.expectedCurrentStageId.length > 0 &&
    isScheduledRollover(candidate.expectedRollover)
}

function sameSchedule(
  current: ScheduledStageRollover | null,
  expected: ScheduledStageRollover,
): boolean {
  return current !== null &&
    current.id === expected.id &&
    current.requestedAt === expected.requestedAt &&
    current.effectiveWeekStart === expected.effectiveWeekStart &&
    current.postponedCount === expected.postponedCount
}

function stageState(snapshot: PersistedSnapshot): StageRolloverState {
  return {
    liveStages: snapshot.liveStages,
    currentLiveStageId: snapshot.currentLiveStageId,
    scheduledStageRollover: snapshot.scheduledStageRollover,
    trades: snapshot.trades,
    weeklyReviews: snapshot.weeklyReviews ?? [],
    riskPolicyVersions: snapshot.riskPolicyVersions,
  }
}

function publishState(snapshot: PersistedSnapshot): StageRolloverPublishState {
  return {
    liveStages: snapshot.liveStages,
    currentLiveStageId: snapshot.currentLiveStageId,
    scheduledStageRollover: null,
  }
}

/**
 * 在现有资料库独占门内重新加载并重新判定；renderer 只提供 stale 预期，
 * 候选、时钟、阶段 ID、备份和保存全部由主进程掌握。
 */
export async function commitDueStageRollover(
  input: StageRolloverCommitInput,
  dependencies: StageRolloverCommitDependencies,
): Promise<StageRolloverCommitResult> {
  if (!isCommitInput(input)) return failure('stale', '阶段切换请求无效')

  try {
    return await dependencies.runExclusive(async () => {
      let storage: StageRolloverCommitStorage
      let current: PersistedSnapshot | null
      try {
        storage = await dependencies.loadStorage()
        current = storage.loadSnapshot()
      } catch (error) {
        dependencies.reportError('stage-rollover-reload-failed', error)
        return failure('write-failed', '无法读取当前阶段状态')
      }

      if (
        !current ||
        current.currentLiveStageId !== input.expectedCurrentStageId ||
        !sameSchedule(current.scheduledStageRollover, input.expectedRollover)
      ) {
        return failure('stale', '资料库中的阶段状态已经变化')
      }

      const committedAt = dependencies.now()
      let inspection
      try {
        const currentTradingDayKey = getTradingDayKey(
          committedAt,
          current.display.tradingDayStartHour,
        )
        inspection = inspectDueStageRollover(stageState(current), currentTradingDayKey)
      } catch (error) {
        dependencies.reportError('stage-rollover-inspection-failed', error)
        return failure('validation-failed', '当前阶段状态无法通过切换检查')
      }
      if (inspection.kind === 'not-due') {
        return failure('stale', '阶段切换尚未到期')
      }
      if (inspection.kind === 'blocked') {
        return failure('stale', '阶段切换条件已经变化')
      }

      let backupReference: string | null
      try {
        backupReference = dependencies.createBackup(storage)
      } catch (error) {
        dependencies.reportError('stage-rollover-backup-create-failed', error)
        return failure('backup-failed', '无法创建重置前备份')
      }
      if (!backupReference) return failure('backup-failed', '无法创建重置前备份')

      try {
        const verification = await dependencies.verifyBackup(storage, backupReference)
        if (verification.status !== 'verified') {
          return failure('backup-failed', '重置前备份验证失败')
        }
      } catch (error) {
        dependencies.reportError('stage-rollover-backup-verification-failed', error)
        return failure('backup-failed', '重置前备份验证失败')
      }

      let candidate: PersistedSnapshot
      try {
        const rollover = buildStageRolloverCandidate(stageState(current), {
          effectiveWeekStart: inspection.scheduled.effectiveWeekStart,
          now: committedAt.toISOString(),
          nextStageId: dependencies.createStageId(),
        })
        candidate = {
          ...current,
          liveStages: rollover.liveStages,
          currentLiveStageId: rollover.currentLiveStageId,
          scheduledStageRollover: null,
        }
        dependencies.validateSnapshot(candidate)
      } catch (error) {
        dependencies.reportError('stage-rollover-candidate-validation-failed', error)
        return failure('validation-failed', '阶段切换候选验证失败')
      }

      try {
        const receipt = storage.saveSnapshot(candidate)
        if (receipt?.kind === 'committed-after-write-error') {
          let authoritative: PersistedSnapshot | null
          try {
            authoritative = storage.loadSnapshot()
            if (!authoritative) throw new Error('committed snapshot missing after atomic recovery')
            dependencies.validateSnapshot(authoritative)
            if (!sameSnapshot(authoritative, candidate)) {
              throw new Error('committed snapshot differs from rollover candidate')
            }
          } catch (error) {
            dependencies.reportError('stage-rollover-committed-reload-failed', error)
            return failure(
              'recovery-required',
              '阶段已写入但权威状态无法确认，请重新打开应用检查资料库',
            )
          }
          candidate = authoritative
        }
      } catch (error) {
        dependencies.reportError('stage-rollover-write-failed', error)
        if (snapshotSaveErrorOutcome(error) === 'indeterminate') {
          return failure(
            'recovery-required',
            '阶段写入结果无法确认，已停止继续保存，请重新打开应用检查资料库',
          )
        }
        return failure('write-failed', '阶段切换写入失败')
      }
      return { ok: true, publish: publishState(candidate) }
    })
  } catch (error) {
    dependencies.reportError('stage-rollover-exclusive-commit-failed', error)
    return failure('write-failed', '阶段切换提交失败')
  }
}
