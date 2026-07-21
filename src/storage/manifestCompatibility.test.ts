import fs from 'node:fs/promises'
import { assertCompatibleManifest } from '@/storage/manifestCompatibility'
import { SCHEMA_VERSION } from '@/storage/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testAssertCompatibleManifestRejectsFutureSchema(): void {
  let rejected = false
  let message = ''
  try {
    assertCompatibleManifest({
      schemaVersion: SCHEMA_VERSION + 1,
      libraryId: 'future-library',
      createdAt: '2026-07-14T00:00:00.000Z',
    })
  } catch (error) {
    rejected = true
    message = error instanceof Error ? error.message : String(error)
  }
  assert(rejected, '高于当前版本的清单必须拒绝')
  assert(message.includes('更新版本'), '未来 schema 错误信息必须明确可读')
}

export function testAssertCompatibleManifestAcceptsCurrentSchema(): void {
  assertCompatibleManifest({
    schemaVersion: SCHEMA_VERSION,
    libraryId: 'current-library',
    createdAt: '2026-07-14T00:00:00.000Z',
  })
}

export async function testIndexedDbOpenReusesFutureSchemaGuard(): Promise<void> {
  const source = await fs.readFile('src/storage/indexedDbAdapter.ts', 'utf8')
  const openStart = source.indexOf('async open(): Promise<void>')
  const openEnd = source.indexOf('private requireDb()', openStart)
  const body = source.slice(openStart, openEnd)
  assert(openStart >= 0 && openEnd > openStart, 'IndexedDB open 实现必须存在')
  assert(body.includes('assertCompatibleManifest(manifest)'), '默认开库必须复用未来 schema 拒写')
  assert(
    body.indexOf('if (!manifest)') < body.indexOf('assertCompatibleManifest(manifest)'),
    '仅在已有清单时校验；新建库仍可写入当前版本',
  )
}
