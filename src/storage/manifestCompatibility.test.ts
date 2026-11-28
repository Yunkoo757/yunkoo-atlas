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
