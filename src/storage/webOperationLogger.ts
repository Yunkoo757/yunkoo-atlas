export type WebOperationKind = 'archive' | 'import' | 'gc'
export type WebOperationStatus = 'start' | 'success' | 'failure'

export interface WebOperationLogRecord {
  event: string
  operationId: string
  actionId: string
  requestId: string
  platform: 'web' | 'electron-renderer'
  stage: string
  status: WebOperationStatus
  code: string
  revisionBefore: number
  revisionAfter: number
  durationMs: number
}

export interface WebOperationLogHandle {
  readonly operationId: string
  success(options: { stage: string; revisionAfter?: number; code?: string }): boolean
  failure(error: unknown, options: { stage: string; code?: string }): boolean
}

const MAX_RECORDS = 200
const records: WebOperationLogRecord[] = []

function codeOf(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return fallback
  const code = String((error as { code?: unknown }).code)
  return /^(?:[A-Z][A-Z0-9_-]+|[a-z][a-z0-9-]+)$/.test(code) ? code : fallback
}

function append(record: WebOperationLogRecord): void {
  records.push(Object.freeze(record))
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
}

/** Web 诊断环只保留操作元数据，不接收正文、路径、附件或原始 Error。 */
export function beginWebOperation(
  kind: WebOperationKind,
  options: {
    operationId?: string
    actionId?: string
    requestId?: string
    platform?: WebOperationLogRecord['platform']
    stage: string
    revisionBefore?: number
    now?: () => number
  },
): WebOperationLogHandle {
  const now = options.now ?? Date.now
  const startedAt = now()
  const operationId = options.operationId ?? crypto.randomUUID()
  const actionId = options.actionId ?? operationId
  const requestId = options.requestId ?? operationId
  const revisionBefore = options.revisionBefore ?? 0
  let terminal = false

  const emit = (
    status: WebOperationStatus,
    stage: string,
    code: string,
    revisionAfter: number,
  ) => append({
    event: `${kind}:${status}`,
    operationId,
    actionId,
    requestId,
    platform: options.platform ?? 'web',
    stage,
    status,
    code,
    revisionBefore,
    revisionAfter,
    durationMs: Math.max(0, now() - startedAt),
  })

  emit('start', options.stage, 'operation-started', revisionBefore)
  return {
    operationId,
    success(finish) {
      if (terminal) return false
      terminal = true
      emit('success', finish.stage, finish.code ?? 'operation-succeeded', finish.revisionAfter ?? revisionBefore)
      return true
    },
    failure(error, finish) {
      if (terminal) return false
      terminal = true
      emit('failure', finish.stage, finish.code ?? codeOf(error, 'operation-failed'), revisionBefore)
      return true
    },
  }
}

export function getWebOperationLogs(): readonly WebOperationLogRecord[] {
  return records.map((record) => ({ ...record }))
}

export function clearWebOperationLogsForTests(): void {
  records.length = 0
}
