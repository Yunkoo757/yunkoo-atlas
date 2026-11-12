import { createHash } from 'node:crypto'

const SAFE_KEYS = new Set([
  'operationId', 'actionId', 'requestId', 'stage', 'code', 'revision',
  'revisionBefore', 'revisionAfter', 'durationMs', 'status',
  'version', 'platform', 'packaged', 'exitCode', 'signal',
])

function hashDetail(value: unknown): string {
  let text: string
  try {
    const serialized = value instanceof Error ? value.stack ?? value.message
      : typeof value === 'string' ? value : JSON.stringify(value)
    text = typeof serialized === 'string' ? serialized : String(value)
  } catch {
    try { text = String(value) } catch { text = `[unserializable ${typeof value}]` }
  }
  return createHash('sha256').update(text).digest('hex')
}

/** 诊断日志只保留稳定类别和非敏感元数据；原始正文、路径、对象与 stack 仅做散列。 */
export function sanitizeDiagnosticDetail(detail: unknown): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  try {
    if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
      for (const key of SAFE_KEYS) {
        // 白名单提取不运行访问器；散列单独处理序列化失败。
        const descriptor = Object.getOwnPropertyDescriptor(detail, key)
        if (!descriptor || !('value' in descriptor)) continue
        const value = descriptor.value
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
          sanitized[key] = value
        }
      }
    }
  } catch { /* revoked Proxy 等异常详情不能让诊断再次抛错。 */ }
  const code = sanitized.code
  if (!(typeof code === 'number' && Number.isFinite(code)) &&
      !(typeof code === 'string' && /^(?:[A-Z][A-Z0-9_-]+|[a-z][a-z0-9-]+)$/.test(code))) {
    sanitized.code = 'UNEXPECTED'
  }
  sanitized.detailHash = hashDetail(detail)
  return sanitized
}

/** 控制台与文件诊断使用同一脱敏边界，禁止原始 Error、URL、路径或业务对象旁路。 */
export function safeConsoleError(event: string, detail: unknown): void {
  console.error(`[electron] ${event}`, JSON.stringify(sanitizeDiagnosticDetail(detail)))
}
