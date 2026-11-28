import { useSaveStatus } from '@/store/saveStatus'
import {
  PersistenceController,
  type PersistenceDiagnostics,
  type PersistenceCapture,
} from '@/storage/persistenceController'
import { getStorage } from '@/storage/provider'
import type { PersistedSnapshot } from '@/storage/types'

// 恢复由主进程重新建立文档。原文档的启动与写入型操作共享同一份撤销信号。
const recovery = new AbortController()
export const storageDocumentSignal = recovery.signal

const controller = new PersistenceController({
  async saveSnapshot(snapshot) {
    try {
      await getStorage().saveSnapshot(snapshot)
    } catch (error) {
      console.error('Persist failed', error)
      throw error
    }
  },
  status: {
    getStatus: () => useSaveStatus.getState().status,
    setDirty: () => useSaveStatus.getState().setDirty(),
    setSaving: () => useSaveStatus.getState().setSaving(),
    setSaved: () => useSaveStatus.getState().setSaved(),
    setError: (error) => useSaveStatus.getState().setError(error),
    reset: () => useSaveStatus.getState().reset(),
  },
  clock: {
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
})

export function setPreFlushCallback(callback: (() => Promise<void>) | null): void {
  controller.setPreFlushCallback(callback)
}

export function enablePersistWrites(capture: () => PersistenceCapture): void {
  storageDocumentSignal.throwIfAborted()
  controller.enableWrites(capture)
}

export function disablePersistWrites(): void {
  controller.disableWrites()
}

export function stopStorageForRecovery(message: string): void {
  controller.disableWrites()
  recovery.abort(new Error(message))
}

export function hasPendingChanges(): boolean {
  return controller.hasPendingChanges()
}

export function schedulePersist(snapshot: PersistedSnapshot): void {
  controller.schedule(snapshot)
}

export function suspendPersist() {
  return controller.suspend()
}

export async function withPersistSuspended<T>(fn: () => T | Promise<T>): Promise<T> {
  const pause = suspendPersist()
  try {
    return await Promise.resolve(fn())
  } finally {
    await pause.resumeAndFlush()
  }
}

export function getPersistSuspendDepth(): number {
  return controller.getSuspendDepth()
}

export function getPersistenceDiagnostics(): PersistenceDiagnostics {
  return controller.getDiagnostics()
}

export function resetPersistenceDiagnostics(): void {
  controller.resetDiagnostics()
}

export async function flushPersistNow(): Promise<void> {
  await controller.flushNow()
}
