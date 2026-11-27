export type StorageOperationKind = 'archive' | 'import' | 'gc'
export type OperationKind = StorageOperationKind | 'quit' | 'stage-rollover'
export type OperationStatus = 'start' | 'success' | 'failure'

export interface OperationLogFields {
  operationId: string
  actionId: string
  requestId: string
  stage: string
  status: OperationStatus
  code: string
  revisionBefore: number | null
  revisionAfter: number | null
  durationMs: number
}

export interface BeginOperationOptions {
  operationId?: string
  actionId?: string
  requestId?: string
  stage: string
  revisionBefore?: number | null
  now?: () => number
}

export interface FinishOperationOptions {
  stage: string
  code?: string
  revisionAfter?: number | null
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
export function beginLoggedOperation(
  kind: OperationKind,
  options: BeginOperationOptions,
  createId: () => string,
  write: (event: string, fields: OperationLogFields) => void,
): OperationLogHandle {
  const now = options.now ?? Date.now
  const startedAt = now()
  const operationId = options.operationId ?? createId()
  const actionId = options.actionId ?? operationId
  const requestId = options.requestId ?? operationId
  const revisionBefore = options.revisionBefore ?? null
  let terminal = false

  const emit = (
    status: OperationStatus,
    stage: string,
    code: string,
    revisionAfter: number | null,
  ) => {
    write(`${kind}:${status}`, {
      operationId,
      actionId,
      requestId,
      stage,
      status,
      code,
      revisionBefore,
      revisionAfter,
      durationMs: Math.max(0, now() - startedAt),
    })
  }

  emit('start', options.stage, 'operation-started', revisionBefore)

  return {
    operationId,
    success(finish) {
      if (terminal) return false
      terminal = true
      emit(
        'success',
        finish.stage,
        finish.code ?? 'operation-succeeded',
        finish.revisionAfter === undefined ? revisionBefore : finish.revisionAfter,
      )
      return true
    },
    failure(error, finish) {
      if (terminal) return false
      terminal = true
      emit(
        'failure',
        finish.stage,
        finish.code ?? codeOf(error, 'operation-failed'),
        revisionBefore,
      )
      return true
    },
  }
}
