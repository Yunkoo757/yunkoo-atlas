import {
  beginLoggedOperation,
  type BeginOperationOptions,
  type FinishOperationOptions,
  type OperationLogFields,
  type OperationLogHandle,
  type StorageOperationKind,
} from '@/lib/operationLog'

export type { OperationStatus as WebOperationStatus, StorageOperationKind as WebOperationKind } from '@/lib/operationLog'

export interface WebOperationLogRecord extends OperationLogFields {
  event: string
  platform: 'web' | 'electron-renderer'
}

export interface WebOperationLogHandle extends Omit<OperationLogHandle, 'failure'> {
  failure(error: unknown, options: Omit<FinishOperationOptions, 'revisionAfter'>): boolean
}

const MAX_RECORDS = 200
const records: WebOperationLogRecord[] = []

/** Web 诊断环只保留最近的操作元数据。 */
export function beginWebOperation(
  kind: StorageOperationKind,
  options: BeginOperationOptions & { platform?: WebOperationLogRecord['platform'] },
): WebOperationLogHandle {
  return beginLoggedOperation(kind, options, () => crypto.randomUUID(), (event, fields) => {
    records.push(Object.freeze({ event, ...fields, platform: options.platform ?? 'web' }))
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
  })
}

export function getWebOperationLogs(): readonly WebOperationLogRecord[] {
  return records.map((record) => ({ ...record }))
}

export function clearWebOperationLogsForTests(): void {
  records.length = 0
}
