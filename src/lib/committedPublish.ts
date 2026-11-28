import type { PersistencePause } from '@/storage/persistenceController'
import type { LibraryImportOptions } from '@/storage/adapter'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import {
  disablePersistWrites, flushPersistNow,
  getPersistSuspendDepth, storageDocumentSignal, suspendPersist,
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
  publish(updateStore: () => void): void
}

interface SnapshotBatchOptions {
  persist(snapshot: PersistedSnapshot, options?: LibraryImportOptions): Promise<void>
  beforeCommit: () => Promise<void>
  source: 'NotionImport' | 'TradeComposer' | 'JsonImport' | 'StageBoundaryRepair'
}

interface BatchOutcome<Result> {
  result: Result
  finalSave?: 'required'
}

/** 先写入快照，再发布本批变化。提交后发布失败时，禁止旧内存覆盖已写入的数据。 */
export async function commitSnapshotBatch<Result extends object>(
  options: SnapshotBatchOptions,
  apply: (writer: BatchWriter) => Promise<BatchOutcome<Result>>,
): Promise<Result & { trailingSaveFailed: boolean }> {
  const signal = storageDocumentSignal
  const unlock = lockStorageCutoverInteraction(signal)
  let committed: PersistedSnapshot | undefined
  const report = (message: string, error: unknown) => console.error(`[${options.source}] ${message}`, error)

  async function retrySaveIfUnheld() {
    if (!signal.aborted && getPersistSuspendDepth() === 0) {
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
    signal.throwIfAborted()
    const pause = suspendPersist()
    let needsTrailingSave = false
    let compensated = false
    let outcome: BatchOutcome<Result>
    try {
      outcome = await apply({
        get diskAhead() { return committed !== undefined },
        async commit(snapshot, commitOptions) {
          signal.throwIfAborted()
          await options.persist(snapshot, commitOptions)
          committed = snapshot
          signal.throwIfAborted()
        },
        async compensate(snapshot) {
          signal.throwIfAborted()
          await options.persist(snapshot, { pruneUnreferenced: true })
          committed = undefined
          compensated = true
          signal.throwIfAborted()
        },
        publish(updateStore) {
          signal.throwIfAborted()
          updateStore()
        },
      })
      signal.throwIfAborted()
      // 同步 Store 订阅和发布后的微任务也可改写内容，只有此时才能决定是否跳过补写。
      if (committed && outcome.finalSave !== 'required') needsTrailingSave = pause.hasChangesSince(committed)
    } catch (error) {
      if (signal.aborted) {
        pause.resume({ flushNow: false })
        throw error
      }
      if (committed || error instanceof DurableStorePublishError) {
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
    } else if (needsTrailingSave) {
      try {
        await resumeAndSave(pause)
      } catch (error) {
        signal.throwIfAborted()
        report('failed to persist concurrent changes after commit', error)
        return { ...outcome.result, trailingSaveFailed: true }
      }
    } else if (!committed) {
      pause.resume({ flushNow: false })
    } else {
      try {
        pause.discardAndResume()
      } catch (error) {
        throw durablePublishFailure(error)
      }
    }
    signal.throwIfAborted()
    return { ...outcome.result, trailingSaveFailed: false }
  } catch (error) {
    // 已进入恢复界面时保留首次恢复原因，同时告知调用方已经落盘。
    if (signal.aborted && committed && !(error instanceof DurableStorePublishError)) {
      throw new DurableStorePublishError(signal.reason)
    }
    throw error
  } finally {
    unlock()
  }
}
