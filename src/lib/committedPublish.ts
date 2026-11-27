import type { StorageAdapter } from '@/storage/adapter'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import {
  disablePersistWrites, discardPendingAndResumePersist, flushPersistNow,
  getPersistSuspendDepth, resumePersistAndFlush, suspendPersist,
} from '@/storage/persist'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'
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
  commit(snapshot: PersistedSnapshot): Promise<void>
  compensate(snapshot: PersistedSnapshot): Promise<void>
}

interface TradeBatchOptions {
  storage: Pick<StorageAdapter, 'commitImport'>
  assets: ExportAssetRecord[]
  beforeCommit: () => Promise<void>
  source: 'NotionImport' | 'TradeComposer'
}

/** 录入或导入一批交易与附件。提交后发布失败时，禁止旧内存覆盖已写入的数据。 */
export async function commitTradeBatch<Result extends object>(
  options: TradeBatchOptions,
  apply: (writer: BatchWriter) => Promise<{ result: Result; hasConcurrentChanges: boolean }>,
): Promise<Result & { trailingSaveFailed: boolean }> {
  const unlock = lockStorageCutoverInteraction()
  const report = (message: string, error: unknown) => console.error(`[${options.source}] ${message}`, error)

  async function retrySaveIfUnheld() {
    if (getPersistSuspendDepth() === 0) {
      await flushPersistNow().catch(error => report('failed to retry persistence', error))
    }
  }

  // resumeAndFlush 先归还暂停，再等待写盘。重试只能写盘，不能再次减少暂停深度。
  async function resumeAndSave() {
    try {
      await resumePersistAndFlush()
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
    suspendPersist()
    let diskAhead = false
    let compensated = false
    let outcome: { result: Result; hasConcurrentChanges: boolean }
    try {
      outcome = await apply({
        async commit(snapshot) {
          await options.storage.commitImport(snapshot, options.assets)
          diskAhead = true
        },
        async compensate(snapshot) {
          await options.storage.commitImport(snapshot, options.assets, { pruneUnreferenced: true })
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
            discardPendingAndResumePersist()
          } catch (cleanupError) {
            report('failed to reset persistence after durable write', cleanupError)
          }
        }
      }
      if (compensated) await resumeAndSave()
      else await resumeAndSave().catch(saveError => report('failed to save after batch error', saveError))
      throw error
    }

    if (outcome.hasConcurrentChanges) {
      try {
        await resumeAndSave()
      } catch (error) {
        report('failed to persist concurrent changes after commit', error)
        return { ...outcome.result, trailingSaveFailed: true }
      }
    } else {
      try {
        discardPendingAndResumePersist()
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
