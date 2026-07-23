import { createHash } from 'node:crypto'

const SAFE_KEYS = new Set([
  'operationId', 'actionId', 'requestId', 'stage', 'code', 'revision',
  'revisionBefore', 'revisionAfter', 'durationMs', 'status',
  'version', 'platform', 'packaged', 'exitCode', 'signal',
])

function hashDetail(value: unknown): string {
  let text: string
  if (value instanceof Error) text = value.stack ?? value.message
  else if (typeof value === 'string') text = value
  else {
    try { text = JSON.stringify(value) } catch { text = String(value) }
  }
  return createHash('sha256').update(text).digest('hex')
}

/** 诊断日志只保留稳定类别和非敏感元数据；原始正文、路径、对象与 stack 仅做散列。 */
export function sanitizeDiagnosticDetail(detail: unknown): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    for (const [key, value] of Object.entries(detail)) {
      if (!SAFE_KEYS.has(key)) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        sanitized[key] = value
      }
    }
  }
  if (!('code' in sanitized)) {
    const code = typeof detail === 'object' && detail !== null && 'code' in detail
      ? String((detail as { code?: unknown }).code)
      : 'UNEXPECTED'
    sanitized.code = /^(?:[A-Z][A-Z0-9_-]+|[a-z][a-z0-9-]+)$/.test(code) ? code : 'UNEXPECTED'
  }
  sanitized.detailHash = hashDetail(detail)
  return sanitized
}

/** 控制台与文件诊断使用同一脱敏边界，禁止原始 Error、URL、路径或业务对象旁路。 */
export function safeConsoleError(event: string, detail: unknown): void {
  console.error(`[electron] ${event}`, JSON.stringify(sanitizeDiagnosticDetail(detail)))
}
