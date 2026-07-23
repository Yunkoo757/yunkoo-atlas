import { randomUUID } from 'node:crypto'
import { logDiagnostic } from './diagnostics'

export type OperationKind = 'archive' | 'import' | 'gc' | 'quit'
export type OperationStatus = 'start' | 'success' | 'failure'

export interface OperationLogDetail {
  operationId: string
  actionId: string
  requestId: string
  platform: string
  stage: string
  status: OperationStatus
  code: string
  revisionBefore: number
  revisionAfter: number
  durationMs: number
}

type OperationLogSink = (
  level: 'info' | 'error',
  event: string,
  detail: OperationLogDetail,
) => void

export interface BeginOperationOptions {
  operationId?: string
  actionId?: string
  requestId?: string
  platform?: string
  stage: string
  revisionBefore?: number
  now?: () => number
  sink?: OperationLogSink
}

export interface FinishOperationOptions {
  stage: string
  code?: string
  revisionAfter?: number
}

export interface OperationLogHandle {
  readonly operationId: string
  success(options: FinishOperationOptions): boolean
  failure(error: unknown, options: FinishOperationOptions): boolean
}

function codeOf(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return fallback
  const code = String((error as { code?: unknown }).code)
  return /^(?:[A-Z][A-Z0-9_-]+|[a-z][a-z0-9-]+)$/.test(code) ? code : fallback
}

/** 为持久化操作写入一条 start 和至多一条终态；日志只包含脱敏白名单字段。 */
export function beginOperation(
  kind: OperationKind,
  options: BeginOperationOptions,
): OperationLogHandle {
  const now = options.now ?? Date.now
  const sink = options.sink ?? logDiagnostic
  const startedAt = now()
  const operationId = options.operationId ?? randomUUID()
  const actionId = options.actionId ?? operationId
  const requestId = options.requestId ?? operationId
  const platform = options.platform ?? process.platform
  const revisionBefore = options.revisionBefore ?? 0
  let terminal = false

  const emit = (
    level: 'info' | 'error',
    status: OperationStatus,
    stage: string,
    code: string,
    revisionAfter: number,
  ) => {
    sink(level, `${kind}:${status}`, {
      operationId,
      actionId,
      requestId,
      platform,
      stage,
      status,
      code,
      revisionBefore,
      revisionAfter,
      durationMs: Math.max(0, now() - startedAt),
    })
  }

  emit('info', 'start', options.stage, 'operation-started', revisionBefore)

  return {
    operationId,
    success(finish) {
      if (terminal) return false
      terminal = true
      emit(
        'info',
        'success',
        finish.stage,
        finish.code ?? 'operation-succeeded',
        finish.revisionAfter ?? revisionBefore,
      )
      return true
    },
    failure(error, finish) {
      if (terminal) return false
      terminal = true
      emit(
        'error',
        'failure',
        finish.stage,
        finish.code ?? codeOf(error, 'operation-failed'),
        revisionBefore,
      )
      return true
    },
  }
}
