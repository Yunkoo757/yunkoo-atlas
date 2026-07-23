export type QuitIntent = 'close' | 'quit' | 'quit-and-install'

export type QuitResult =
  | { ok: true; intent: QuitIntent }
  | { ok: false; error: string }

export type QuitFailureStage = 'renderer-flush' | 'verified-backup' | 'commit-exit'
export type QuitFailureCode =
  | 'quit-flush-failed'
  | 'quit-backup-failed'

export interface QuitOperationalFailure {
  operationId: string
  stage: QuitFailureStage
  code: QuitFailureCode
  durationMs: number
  message: string
}

export interface QuitOperationalLifecycle {
  operationId: string
  stage: QuitFailureStage
  durationMs: number
}

export interface QuitCoordinatorDependencies {
  timeoutMs: number
  now?(): number
  createRequestId(): string
  requestRendererFlush(requestId: string, signal: AbortSignal): Promise<void>
  createVerifiedBackup(signal: AbortSignal): Promise<void>
  commitExit(resolveIntent: () => QuitIntent, signal: AbortSignal, deadlineAt: number): Promise<void>
  cancelPreparation(): Promise<void> | void
  reportStart?(event: QuitOperationalLifecycle): void
  reportSuccess?(event: QuitOperationalLifecycle): void
  reportError(failure: QuitOperationalFailure): void
}

export async function releaseThenFinalizeWithRollback(
  release: () => void,
  finalize: () => void,
  rollback: () => Promise<void>,
): Promise<void> {
  release()
  try {
    finalize()
  } catch (error) {
    await rollback()
    throw error
  }
}

export function assertExitWithinDeadline(
  signal: AbortSignal,
  deadlineAt: number,
  now: () => number = Date.now,
): void {
  if (signal.aborted || now() >= deadlineAt) {
    throw new Error('退出协调等待超时，已取消退出')
  }
}

const INTENT_PRIORITY: Record<QuitIntent, number> = {
  close: 0,
  quit: 1,
  'quit-and-install': 2,
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class QuitCoordinator {
  private active: Promise<QuitResult> | null = null
  private requestedIntent: QuitIntent = 'close'

  constructor(private readonly dependencies: QuitCoordinatorDependencies) {}

  request(intent: QuitIntent): Promise<QuitResult> {
    if (INTENT_PRIORITY[intent] > INTENT_PRIORITY[this.requestedIntent]) {
      this.requestedIntent = intent
    }
    if (this.active) return this.active

    const requestId = this.dependencies.createRequestId()
    const controller = new AbortController()
    const now = this.dependencies.now ?? Date.now
    const deadlineAt = now() + this.dependencies.timeoutMs
    const startedAt = now()
    let stage: QuitFailureStage = 'renderer-flush'
    this.dependencies.reportStart?.({ operationId: requestId, stage, durationMs: 0 })
    const assertWithinDeadline = () => {
      try {
        assertExitWithinDeadline(controller.signal, deadlineAt, now)
      } catch (error) {
        controller.abort()
        throw error
      }
    }
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        reject(new Error('退出协调等待超时，已取消退出'))
      }, this.dependencies.timeoutMs)
      controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    })

    const run = async (): Promise<QuitResult> => {
      await this.dependencies.requestRendererFlush(requestId, controller.signal)
      assertWithinDeadline()
      stage = 'verified-backup'
      await this.dependencies.createVerifiedBackup(controller.signal)
      assertWithinDeadline()
      stage = 'commit-exit'
      let committedIntent: QuitIntent | null = null
      const resolveIntent = () => {
        committedIntent = this.requestedIntent
        return committedIntent
      }
      await this.dependencies.commitExit(resolveIntent, controller.signal, deadlineAt)
      this.dependencies.reportSuccess?.({
        operationId: requestId,
        stage,
        durationMs: Math.max(0, now() - startedAt),
      })
      controller.abort()
      return { ok: true, intent: committedIntent ?? this.requestedIntent }
    }

    const active = Promise.race([run(), timeout]).catch((error) => {
      controller.abort()
      const message = messageOf(error)
      return Promise.resolve(this.dependencies.cancelPreparation()).then(() => {
        const code: QuitFailureCode = stage === 'renderer-flush'
          ? 'quit-flush-failed'
          : 'quit-backup-failed'
        this.dependencies.reportError({
          operationId: requestId,
          stage,
          code,
          durationMs: Math.max(0, now() - startedAt),
          message,
        })
        return { ok: false as const, error: message }
      })
    }).then((result) => {
      this.active = null
      this.requestedIntent = 'close'
      return result
    })
    this.active = active
    return active
  }
}

export type FlushAcknowledgeResult = 'ignored' | 'pending' | 'complete' | 'failed'

export class RendererFlushTracker {
  private readonly pending: Set<number>
  private failed = false

  constructor(
    private readonly requestId: string,
    webContentsIds: number[],
  ) {
    this.pending = new Set(webContentsIds)
  }

  acknowledge(
    requestId: string,
    webContentsId: number,
    ok: boolean,
  ): FlushAcknowledgeResult {
    if (this.failed || requestId !== this.requestId || !this.pending.has(webContentsId)) {
      return 'ignored'
    }
    if (!ok) {
      this.failed = true
      return 'failed'
    }
    this.pending.delete(webContentsId)
    return this.pending.size === 0 ? 'complete' : 'pending'
  }

  isFailed(): boolean {
    return this.failed
  }
}
