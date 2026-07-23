import type { PersistedSnapshot } from '@/storage/types'

export type PersistenceSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface PersistenceCapture {
  snapshot: PersistedSnapshot
  stateReference: unknown
  shortcutReference: unknown
}

export interface PersistenceStatusSink {
  getStatus(): PersistenceSaveStatus
  setDirty(): void
  setSaving(): void
  setSaved(): void
  setError(error?: unknown): void
  reset(): void
}

export interface PersistenceClock {
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

export interface PersistenceControllerDependencies {
  saveSnapshot(snapshot: PersistedSnapshot): Promise<void>
  captureSnapshot(): PersistenceCapture
  status: PersistenceStatusSink
  clock: PersistenceClock
  debounceMs?: number
  maxStablePreflushWrites?: number
}

export interface PersistenceDiagnostics {
  pendingSnapshotCount: 0 | 1
  maxPendingSnapshotCount: 0 | 1
}

export class PersistenceController {
  private readonly debounceMs: number
  private readonly maxStablePreflushWrites: number
  private preFlushCallback: (() => Promise<void>) | null = null
  private timer: unknown = null
  private pending: PersistedSnapshot | null = null
  private maxPendingSnapshotCount: 0 | 1 = 0
  private flushing: Promise<void> | null = null
  private explicitFlushing: Promise<void> | null = null
  private suspendDepth = 0
  private writesEnabled = false

  constructor(private readonly dependencies: PersistenceControllerDependencies) {
    this.debounceMs = dependencies.debounceMs ?? 400
    this.maxStablePreflushWrites = dependencies.maxStablePreflushWrites ?? 8
  }

  setPreFlushCallback(callback: (() => Promise<void>) | null): void {
    this.preFlushCallback = callback
  }

  enableWrites(): void {
    this.writesEnabled = true
  }

  disableWrites(): void {
    this.writesEnabled = false
    this.clearTimer()
    this.setPending(null)
  }

  hasPendingChanges(): boolean {
    const status = this.dependencies.status.getStatus()
    return this.pending !== null || status === 'dirty' || status === 'saving' || status === 'error'
  }

  schedule(snapshot: PersistedSnapshot): void {
    if (!this.writesEnabled) return
    this.setPending(snapshot)
    this.dependencies.status.setDirty()
    if (this.suspendDepth > 0) return
    this.clearTimer()
    this.timer = this.dependencies.clock.setTimeout(() => {
      this.timer = null
      void this.startPendingFlush().catch(() => {})
    }, this.debounceMs)
  }

  suspend(): void {
    this.suspendDepth += 1
    this.clearTimer()
  }

  resume(options?: { flushNow?: boolean }): void {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1)
    if (this.suspendDepth > 0) return
    if (options?.flushNow === false) {
      if (this.pending) this.schedule(this.pending)
      return
    }
    void this.flushNow().catch(() => {})
  }

  discardPendingAndResume(): void {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1)
    this.clearTimer()
    this.setPending(null)
    this.dependencies.status.reset()
  }

  async resumeAndFlush(): Promise<void> {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1)
    if (this.suspendDepth > 0) return
    await this.flushNow()
  }

  getSuspendDepth(): number {
    return this.suspendDepth
  }

  getDiagnostics(): PersistenceDiagnostics {
    return {
      pendingSnapshotCount: this.pending === null ? 0 : 1,
      maxPendingSnapshotCount: this.maxPendingSnapshotCount,
    }
  }

  resetDiagnostics(): void {
    this.maxPendingSnapshotCount = this.pending === null ? 0 : 1
  }

  async flushNow(): Promise<void> {
    if (!this.writesEnabled) return
    const previous = this.explicitFlushing
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(
      () => this.runExplicitFlush(),
    )
    this.explicitFlushing = operation
    void operation.then(
      () => { if (this.explicitFlushing === operation) this.explicitFlushing = null },
      () => { if (this.explicitFlushing === operation) this.explicitFlushing = null },
    )
    return operation
  }

  private clearTimer(): void {
    if (this.timer === null) return
    this.dependencies.clock.clearTimeout(this.timer)
    this.timer = null
  }

  private setPending(snapshot: PersistedSnapshot | null): void {
    this.pending = snapshot
    if (snapshot !== null) this.maxPendingSnapshotCount = 1
  }

  private async flushPending(): Promise<void> {
    while (this.pending) {
      const snapshot = this.pending
      this.setPending(null)
      this.dependencies.status.setSaving()
      try {
        await this.dependencies.saveSnapshot(snapshot)
      } catch (error) {
        this.dependencies.status.setError(error)
        if (this.pending === null) this.setPending(snapshot)
        throw error
      }
    }
    this.clearTimer()
    this.dependencies.status.setSaved()
  }

  private startPendingFlush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.clearTimer()
    const operation = this.flushPending().finally(() => {
      if (this.flushing === operation) this.flushing = null
    })
    this.flushing = operation
    return operation
  }

  private async runExplicitFlush(): Promise<void> {
    this.clearTimer()
    if (this.flushing) await this.flushing
    if (!this.preFlushCallback) {
      this.setPending(this.dependencies.captureSnapshot().snapshot)
      await this.startPendingFlush()
      return
    }

    let writes = 0
    while (true) {
      if (writes > 0) this.dependencies.status.setSaving()
      const before = this.dependencies.captureSnapshot()
      try {
        await this.preFlushCallback()
      } catch (error) {
        this.setPending(this.dependencies.captureSnapshot().snapshot)
        this.dependencies.status.setError(error)
        throw error
      }
      const after = this.dependencies.captureSnapshot()
      const stable = after.stateReference === before.stateReference &&
        after.shortcutReference === before.shortcutReference
      if (writes > 0 && stable) {
        this.dependencies.status.setSaved()
        return
      }
      if (writes >= this.maxStablePreflushWrites) {
        this.setPending(after.snapshot)
        const error = new Error('保存过程中内容持续变化，请稍后重试')
        this.dependencies.status.setError(error)
        throw error
      }
      this.setPending(after.snapshot)
      await this.startPendingFlush()
      writes += 1
    }
  }
}
