import type { StorageRecoveryRequiredState } from '../../src/types/journalBridge'
import { SnapshotSaveError } from './storage'

export function classifyStorageRecoveryRequired(
  error: unknown,
): StorageRecoveryRequiredState | null {
  if (!(error instanceof SnapshotSaveError) || error.outcome !== 'indeterminate') return null
  return {
    code: 'storage-write-indeterminate',
    message: error.message,
  }
}

/** 所有主进程写入口共用此边界，确保业务 handler catch 前先广播恢复要求。 */
export async function withStorageRecoveryNotification<T>(
  operation: () => T | Promise<T>,
  notify: (state: StorageRecoveryRequiredState) => void,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const state = classifyStorageRecoveryRequired(error)
    if (state) notify(state)
    throw error
  }
}
