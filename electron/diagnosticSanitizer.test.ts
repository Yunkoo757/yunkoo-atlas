import { safeConsoleError, sanitizeDiagnosticDetail } from './diagnosticSanitizer'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testDiagnosticSanitizerKeepsOperationalFieldsAndRemovesPrivatePayloads(): void {
  const privatePath = 'C:\\Users\\Yunko\\秘密资料库\\journal.db'
  const privateBody = '<p>绝不能写入日志的交易正文</p>'
  const privateAsset = 'journal-asset://private-attachment-id'
  const sanitized = sanitizeDiagnosticDetail({
    operationId: 'operation-1',
    actionId: 'action-1',
    requestId: 'request-1',
    stage: 'verified-backup',
    code: 'quit-backup-failed',
    revision: 9,
    revisionBefore: 8,
    revisionAfter: 9,
    durationMs: 123,
    message: privateBody,
    path: privatePath,
    asset: privateAsset,
    stack: `Error: ${privateBody}\n at ${privatePath}`,
  })
  const text = JSON.stringify(sanitized)
  assert(sanitized.operationId === 'operation-1', '必须保留 operationId')
  assert(sanitized.actionId === 'action-1' && sanitized.requestId === 'request-1', '必须保留 actionId/requestId')
  assert(sanitized.stage === 'verified-backup', '必须保留失败 stage')
  assert(sanitized.code === 'quit-backup-failed', '必须保留稳定 code')
  assert(sanitized.revision === 9 && sanitized.durationMs === 123, '必须保留 revision/duration')
  assert(sanitized.revisionBefore === 8 && sanitized.revisionAfter === 9, '必须保留 revision 前后值')
  for (const secret of [privatePath, privateBody, privateAsset]) {
    assert(!text.includes(secret), '诊断日志不得包含路径、正文或附件 ID')
  }
  assert(typeof sanitized.detailHash === 'string' && sanitized.detailHash.length === 64, '私密详情只允许保留 SHA-256')
}

export function testDiagnosticSanitizerNeverPersistsRawErrorStack(): void {
  const error = new Error('private note and D:\\private\\journal.db')
  const text = JSON.stringify(sanitizeDiagnosticDetail(error))
  assert(!text.includes(error.message), 'Error.message/stack 不得原样持久化')
  assert(text.includes('UNEXPECTED'), '未分类异常必须使用稳定兜底 code')
}

export function testConsoleDiagnosticsUseTheSamePrivacyBoundary(): void {
  const secret = 'D:\\private\\交易正文.html'
  const writes: string[] = []
  const original = console.error
  console.error = (...values: unknown[]) => { writes.push(values.join(' ')) }
  try {
    safeConsoleError('test-failure', { path: secret, error: new Error(secret) })
  } finally {
    console.error = original
  }
  assert(writes.length === 1, '控制台故障必须只写一条结构化记录')
  assert(!writes[0].includes(secret), '控制台日志不得旁路输出原始路径或 Error')
  assert(writes[0].includes('detailHash'), '控制台仅允许保留私密详情散列')
}
