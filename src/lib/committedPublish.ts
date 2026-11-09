import { disablePersistWrites } from '@/storage/persist'
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
export function durablePublishFailure(cause: unknown): DurableStorePublishError {
  const error = new DurableStorePublishError(cause)
  disablePersistWrites()
  notifyStorageRecoveryRequired(error.message)
  return error
}

export function publishDurablyCommitted(publish: () => void): void {
  try {
    publish()
  } catch (cause) {
    throw durablePublishFailure(cause)
  }
}
