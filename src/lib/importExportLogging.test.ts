import fs from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function functionSource(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(nextName, start)
  assert(start >= 0 && end > start, `${name} source contract missing`)
  return source.slice(start, end)
}

export function testWebExportsPairFlushFailuresAndRecordPostFlushRevision(): void {
  const source = fs.readFileSync('src/lib/importExport.ts', 'utf8').replace(/\r\n/g, '\n')
  const jsonExport = functionSource(source, 'downloadExport', 'export function serializeJsonExportPayload')
  const zipExport = functionSource(source, 'downloadWebJournalZip', 'export function buildWebJournalArchiveBlob')

  for (const [name, body] of [['JSON export', jsonExport], ['ZIP export', zipExport]] as const) {
    const begin = body.indexOf("beginWebOperation('archive'")
    const tryBlock = body.indexOf('try {')
    const flush = body.indexOf('await flushPersistNow()')
    const revisionAfter = body.indexOf('const revisionAfter =')
    const success = body.indexOf('operation.success(')
    const failure = body.indexOf('operation.failure(')
    assert(begin >= 0 && begin < tryBlock, `${name} 必须先记录 start`)
    assert(tryBlock < flush && flush < revisionAfter, `${name} flush 必须受 try/catch 保护并在其后重读 revision`)
    assert(revisionAfter < success && success < failure, `${name} 必须以 post-flush revision 成功并保留 failure 终态`)
  }
}
