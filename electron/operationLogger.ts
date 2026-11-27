import { randomUUID } from 'node:crypto'
import {
  beginLoggedOperation,
  type BeginOperationOptions as LogOptions,
  type OperationKind,
  type OperationLogFields,
  type OperationLogHandle,
} from '../src/lib/operationLog'
import { logDiagnostic } from './diagnostics'

export type { FinishOperationOptions, OperationKind, OperationLogHandle, OperationStatus } from '../src/lib/operationLog'

export interface OperationLogDetail extends OperationLogFields {
  platform: string
}

export interface BeginOperationOptions extends LogOptions {
  platform?: string
  sink?: (level: 'info' | 'error', event: string, detail: OperationLogDetail) => void
}

export function beginOperation(kind: OperationKind, options: BeginOperationOptions): OperationLogHandle {
  const sink = options.sink ?? logDiagnostic
  const platform = options.platform ?? process.platform
  return beginLoggedOperation(kind, options, randomUUID, (event, fields) => {
    sink(fields.status === 'failure' ? 'error' : 'info', event, { ...fields, platform })
  })
}
