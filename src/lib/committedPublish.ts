import type { PersistencePause } from '@/storage/persistenceController'
import type { LibraryImportOptions } from '@/storage/adapter'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import {
  disablePersistWrites, flushPersistNow,
  getPersistSuspendDepth, suspendPersist,
} from '@/storage/persist'
import type { PersistedSnapshot } from '@/storage/types'
import { notifyStorageRecoveryRequired } from '@/lib/storageRecovery'

export class DurableStorePublishError extends Error {
  readonly durablyCommitted = true
  readonly requiresStorageReload = true

  constructor(readonly cause: unknown) {
    super('数据已保存，但界面刷新失败。请重新打开资料库，勿重复提交。')
    this.name = 'DurableStorePublishError'
  }
}

/** 只用于耐久提交之后；发布失败时禁止旧 Store 补偿写回已提交的数据。 */
function durablePublishFailure(cause: unknown): DurableStorePublishError {
  const error = new DurableStorePublishError(cause)
  disablePersistWrites()
  notifyStorageRecoveryRequired(error.message)
  return error
}

interface BatchWriter {
  readonly diskAhead: boolean
  commit(snapshot: PersistedSnapshot, options?: LibraryImportOptions): Promise<void>
  compensate(snapshot: PersistedSnapshot): Promise<void>
}

interface SnapshotBatchOptions {
  persist(snapshot: PersistedSnapshot, options?: LibraryImportOptions): Promise<void>
  beforeCommit: () => Promise<void>
  source: 'NotionImport' | 'TradeComposer' | 'JsonImport' | 'StageBoundaryRepair'
}

interface BatchOutcome<Result> {
  result: Result
  finalSave: 'already-persisted' | 'best-effort' | 'required'
}

/** 先写入快照，再发布本批变化。提交后发布失败时，禁止旧内存覆盖已写入的数据。 */
export async function commitSnapshotBatch<Result extends object>(
  options: SnapshotBatchOptions,
  apply: (writer: BatchWriter) => Promise<BatchOutcome<Result>>,
): Promise<Result & { trailingSaveFailed: boolean }> {
  const unlock = lockStorageCutoverInteraction()
  const report = (message: string, error: unknown) => console.error(`[${options.source}] ${message}`, error)

  async function retrySaveIfUnheld() {
    if (getPersistSuspendDepth() === 0) {
      await flushPersistNow().catch(error => report('failed to retry persistence', error))
    }
  }

  // resumeAndFlush 先归还暂停，再等待写盘。重试只能写盘，不能再次减少暂停深度。
  async function resumeAndSave(pause: PersistencePause) {
    try {
      await pause.resumeAndFlush()
    } catch (error) {
      await retrySaveIfUnheld()
      throw error
    }
  }

  try {
    try {
      await options.beforeCommit()
    } catch (error) {
      await retrySaveIfUnheld()
      throw error
    }
    const pause = suspendPersist()
    let diskAhead = false
    let compensated = false
    let outcome: BatchOutcome<Result>
    try {
      outcome = await apply({
        get diskAhead() { return diskAhead },
        async commit(snapshot, commitOptions) {
          await options.persist(snapshot, commitOptions)
          diskAhead = true
        },
        async compensate(snapshot) {
          await options.persist(snapshot, { pruneUnreferenced: true })
          diskAhead = false
          compensated = true
        },
      })
    } catch (error) {
      if (diskAhead || error instanceof DurableStorePublishError) {
        try {
          throw error instanceof DurableStorePublishError ? error : durablePublishFailure(error)
        } finally {
          try {
            pause.discardAndResume()
          } catch (cleanupError) {
            report('failed to reset persistence after durable write', cleanupError)
          }
        }
      }
      if (compensated) await resumeAndSave(pause)
      else await resumeAndSave(pause).catch(saveError => report('failed to save after batch error', saveError))
      throw error
    }

    if (outcome.finalSave === 'required') {
      await pause.resumeAndFlush()
    } else if (outcome.finalSave === 'best-effort') {
      try {
        await resumeAndSave(pause)
      } catch (error) {
        report('failed to persist concurrent changes after commit', error)
        return { ...outcome.result, trailingSaveFailed: true }
      }
    } else {
      try {
        pause.discardAndResume()
      } catch (error) {
        if (diskAhead) throw durablePublishFailure(error)
        throw error
      }
    }
    return { ...outcome.result, trailingSaveFailed: false }
  } finally {
    unlock()
  }
}
