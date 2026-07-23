export const OPERATIONAL_ERROR_CODES = [
  'snapshot-contract-invalid',
  'unsupported-future-version',
  'desktop-format-not-supported-on-web',
  'storage-revision-conflict',
  'library-location-unavailable',
  'library-location-invalid',
  'quit-flush-failed',
  'quit-backup-failed',
  'quit-commit-failed',
  'import-budget-exceeded',
  'asset-reference-missing',
  'asset-gc-stale-revision',
  'undo-conflict',
  'trade-kind-transition-forbidden',
] as const

export type OperationalErrorCode = (typeof OPERATIONAL_ERROR_CODES)[number]

export class OperationalError extends Error {
  readonly code: OperationalErrorCode
  readonly cause?: unknown

  constructor(code: OperationalErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'OperationalError'
    this.code = code
    this.cause = cause
  }
}
