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
  status: PersistenceStatusSink
  clock: PersistenceClock
  debounceMs?: number
  maxStablePreflushWrites?: number
}

export interface PersistenceDiagnostics {
  pendingSnapshotCount: 0 | 1
  maxPendingSnapshotCount: 0 | 1
}

export interface PersistencePause {
  resume(options?: { flushNow?: boolean }): void
  discardAndResume(): void
  resumeAndFlush(): Promise<void>
}

export class PersistenceController {
  private readonly debounceMs: number
  private readonly maxStablePreflushWrites: number
  private preFlushCallback: (() => Promise<void>) | null = null
  private timer: unknown = null
  private pending: PersistedSnapshot | null = null
  private maxPendingSnapshotCount: 0 | 1 = 0
  private flushing: { generation: number; operation: Promise<void> } | null = null
  private explicitFlushing: Promise<void> | null = null
  private readonly pauses = new Set<symbol>()
  private captureSnapshot: (() => PersistenceCapture) | null = null
  private writeGeneration = 0

  constructor(private readonly dependencies: PersistenceControllerDependencies) {
    this.debounceMs = dependencies.debounceMs ?? 400
    this.maxStablePreflushWrites = dependencies.maxStablePreflushWrites ?? 8
  }

  setPreFlushCallback(callback: (() => Promise<void>) | null): void {
    this.preFlushCallback = callback
  }

  enableWrites(captureSnapshot: () => PersistenceCapture): void {
    this.captureSnapshot ??= captureSnapshot
  }

  disableWrites(): void {
    this.captureSnapshot = null
    this.pauses.clear()
    this.writeGeneration += 1
    this.clearTimer()
    this.setPending(null)
  }

  hasPendingChanges(): boolean {
    const status = this.dependencies.status.getStatus()
    return this.pending !== null || status === 'dirty' || status === 'saving' || status === 'error'
  }

  schedule(snapshot: PersistedSnapshot): void {
    if (!this.captureSnapshot) return
    this.setPending(snapshot)
    this.dependencies.status.setDirty()
    if (this.pauses.size > 0) return
    this.clearTimer()
    this.timer = this.dependencies.clock.setTimeout(() => {
      this.timer = null
      void this.startPendingFlush().catch(() => {})
    }, this.debounceMs)
  }

  suspend(): PersistencePause {
    const token = Symbol()
    this.pauses.add(token)
    this.clearTimer()
    const release = () => this.pauses.delete(token)
    return {
      resume: options => {
        if (!release() || this.pauses.size > 0) return
        if (options?.flushNow === false) {
          if (this.pending) this.schedule(this.pending)
        } else {
          void this.flushNow().catch(() => {})
        }
      },
      discardAndResume: () => {
        if (!release()) return
        this.writeGeneration += 1
        this.clearTimer()
        this.setPending(null)
        this.dependencies.status.reset()
      },
      resumeAndFlush: async () => {
        if (release() && this.pauses.size === 0) await this.flushNow()
      },
    }
  }

  getSuspendDepth(): number {
    return this.pauses.size
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
    const capture = this.captureSnapshot
    if (!capture) return
    const generation = this.writeGeneration
    const previous = this.explicitFlushing
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(
      () => this.isCurrent(generation) ? this.runExplicitFlush(generation, capture) : undefined,
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

  private isCurrent(generation: number): boolean {
    return this.captureSnapshot !== null && generation === this.writeGeneration
  }

  private async flushPending(generation: number, explicit: boolean): Promise<void> {
    while (this.isCurrent(generation) && this.pending && (explicit || this.pauses.size === 0)) {
      const snapshot = this.pending
      this.setPending(null)
      this.dependencies.status.setSaving()
      try {
        await this.dependencies.saveSnapshot(snapshot)
      } catch (error) {
        if (this.isCurrent(generation)) {
          this.dependencies.status.setError(error)
          if (this.pending === null) this.setPending(snapshot)
        }
        throw error
      }
    }
    if (!this.isCurrent(generation) || this.pending) return
    this.clearTimer()
    this.dependencies.status.setSaved()
  }

  private startPendingFlush(generation = this.writeGeneration, explicit = false): Promise<void> {
    if (!this.isCurrent(generation)) return Promise.resolve()
    if (this.flushing) {
      const active = this.flushing
      return active.operation.catch(error => {
        if (active.generation === generation) throw error
      }).then(() => this.startPendingFlush(generation, explicit))
    }
    if (!this.pending || (!explicit && this.pauses.size > 0)) return Promise.resolve()
    this.clearTimer()
    const operation = this.flushPending(generation, explicit).finally(() => {
      if (this.flushing?.operation === operation) this.flushing = null
    })
    this.flushing = { generation, operation }
    return operation
  }

  private async runExplicitFlush(generation: number, capture: () => PersistenceCapture): Promise<void> {
    this.clearTimer()
    if (this.flushing) {
      const active = this.flushing
      await active.operation.catch(error => {
        if (active.generation === generation) throw error
      })
    }
    if (!this.isCurrent(generation)) return
    if (!this.preFlushCallback) {
      this.setPending(capture().snapshot)
      await this.startPendingFlush(generation, true)
      return
    }

    let writes = 0
    while (this.isCurrent(generation)) {
      if (writes > 0) this.dependencies.status.setSaving()
      const before = capture()
      try {
        await this.preFlushCallback()
      } catch (error) {
        if (this.isCurrent(generation)) {
          this.setPending(capture().snapshot)
          this.dependencies.status.setError(error)
        }
        throw error
      }
      if (!this.isCurrent(generation)) return
      const after = capture()
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
      await this.startPendingFlush(generation, true)
      writes += 1
    }
  }
}
