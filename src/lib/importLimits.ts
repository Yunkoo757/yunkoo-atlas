export const MIB = 1024 * 1024

export const MAX_JSON_FILE_BYTES = 64 * MIB
export const MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES = 32 * MIB
export const MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES = 48 * MIB
export const MAX_JSON_TOTAL_ENTITIES = 50_000

export type JsonImportErrorCode =
  | 'json-file-too-large'
  | 'json-entity-limit'
  | 'json-single-asset-too-large'
  | 'json-total-assets-too-large'
  | 'json-invalid-base64'
  | 'json-contract-invalid'

const JSON_IMPORT_ERROR_MESSAGES: Record<JsonImportErrorCode, string> = {
  'json-file-too-large': 'JSON 备份超过 64 MiB，请改用 .journal.zip 备份。',
  'json-entity-limit': 'JSON 备份包含的记录超过 50,000 条，请拆分后重试。',
  'json-single-asset-too-large': 'JSON 备份中有单个附件超过 32 MiB，请改用 .journal.zip 备份。',
  'json-total-assets-too-large': 'JSON 备份中的附件总量超过 48 MiB，请改用 .journal.zip 备份。',
  'json-invalid-base64': 'JSON 备份中的附件内容已损坏。',
  'json-contract-invalid': 'JSON 备份的数据合同无效。',
}

export function getJsonImportErrorMessage(code: JsonImportErrorCode): string {
  return JSON_IMPORT_ERROR_MESSAGES[code]
}

export class JsonImportBudgetError extends Error {
  readonly code: JsonImportErrorCode
  readonly category = 'import-budget-exceeded' as const
  readonly cause?: unknown

  constructor(code: JsonImportErrorCode, cause?: unknown) {
    super(getJsonImportErrorMessage(code))
    this.name = 'JsonImportBudgetError'
    this.code = code
    this.cause = cause
  }
}

export function assertJsonFileByteBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_JSON_FILE_BYTES) {
    throw new JsonImportBudgetError('json-file-too-large')
  }
}

export async function readJsonImportFile(
  file: Pick<File, 'size' | 'text'>,
): Promise<string> {
  assertJsonFileByteBudget(file.size)
  return file.text()
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * 精确复现 `JSON.stringify(value, null, 2)` 的 UTF-8 长度，但不生成完整 JSON 字符串。
 * 用于 writer 在大额字符串分配前拒绝注定超限的输出。
 */
export function estimatePrettyJsonUtf8Bytes(value: unknown): number {
  const active = new WeakSet<object>()

  const visit = (input: unknown, depth: number, inArray: boolean): number | null => {
    let current = input
    if (isRecordLike(current) && typeof current.toJSON === 'function') {
      current = current.toJSON()
    }
    if (current === null) return 4
    if (typeof current === 'string') return utf8ByteLength(JSON.stringify(current))
    if (typeof current === 'boolean') return current ? 4 : 5
    if (typeof current === 'number') {
      const encoded = JSON.stringify(current)
      return encoded.length
    }
    if (typeof current === 'bigint') throw new JsonImportBudgetError('json-contract-invalid')
    if (typeof current === 'undefined' || typeof current === 'function' || typeof current === 'symbol') {
      return inArray ? 4 : null
    }
    if (typeof current !== 'object') throw new JsonImportBudgetError('json-contract-invalid')
    if (active.has(current)) throw new JsonImportBudgetError('json-contract-invalid')
    active.add(current)
    try {
      if (Array.isArray(current)) {
        if (current.length === 0) return 2
        let bytes = 2 + 1 + (depth + 1) * 2 + 1 + depth * 2
        for (let index = 0; index < current.length; index += 1) {
          bytes += visit(current[index], depth + 1, true) ?? 4
          if (index > 0) bytes += 2 + (depth + 1) * 2
        }
        return bytes
      }

      const entries: Array<{ keyBytes: number; valueBytes: number }> = []
      for (const key of Object.keys(current)) {
        const valueBytes = visit((current as Record<string, unknown>)[key], depth + 1, false)
        if (valueBytes === null) continue
        entries.push({ keyBytes: utf8ByteLength(JSON.stringify(key)), valueBytes })
      }
      if (entries.length === 0) return 2
      let bytes = 2 + 1 + (depth + 1) * 2 + 1 + depth * 2
      entries.forEach((entry, index) => {
        bytes += entry.keyBytes + 2 + entry.valueBytes
        if (index > 0) bytes += 2 + (depth + 1) * 2
      })
      return bytes
    } finally {
      active.delete(current)
    }
  }

  const bytes = visit(value, 0, false)
  if (bytes === null) throw new JsonImportBudgetError('json-contract-invalid')
  return bytes
}

/** Base64 的解码长度；调用方必须先确认 encodedLength 为 4 的倍数。 */
export function estimateBase64DecodedBytes(encodedLength: number, padding: 0 | 1 | 2): number {
  return (encodedLength / 4) * 3 - padding
}

export function assertJsonEntityBudget(raw: Record<string, unknown>): void {
  let total = 0
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) total += value.length
    else if ((key === 'shortcuts' || key === 'symbolIcons') && isRecord(value)) {
      total += Object.keys(value).length
    }
    if (total > MAX_JSON_TOTAL_ENTITIES) {
      throw new JsonImportBudgetError('json-entity-limit')
    }
  }
}

export class JsonAttachmentBudget {
  private totalDecodedBytes = 0

  add(encodedLength: number, padding: 0 | 1 | 2): void {
    const decodedBytes = estimateBase64DecodedBytes(encodedLength, padding)
    if (decodedBytes > MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES) {
      throw new JsonImportBudgetError('json-single-asset-too-large')
    }
    this.totalDecodedBytes += decodedBytes
    if (this.totalDecodedBytes > MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES) {
      throw new JsonImportBudgetError('json-total-assets-too-large')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordLike(value: unknown): value is Record<string, unknown> & { toJSON?: () => unknown } {
  return typeof value === 'object' && value !== null
}
