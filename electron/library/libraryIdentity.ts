import fs from 'node:fs'
import { assertCompatibleManifest } from '../../src/storage/manifestCompatibility'
import type { LibraryManifest } from '../../src/storage/types'

export class LibraryIdentityMismatchError extends Error {
  constructor() {
    super('资料库身份与已保存配置不一致，请明确选择正确的资料库')
    this.name = 'LibraryIdentityMismatchError'
  }
}

export function assertLibraryIdentity(actual: unknown, expected?: string): void {
  if (expected !== undefined && actual !== expected) throw new LibraryIdentityMismatchError()
}

export function readCompatibleLibraryManifest(file: string, expectedLibraryId?: string): LibraryManifest {
  const text = fs.readFileSync(file, 'utf8')
  let manifest: LibraryManifest
  try { manifest = JSON.parse(text) }
  catch { throw new Error('资料库清单 manifest.json 不是有效的 JSON') }
  assertCompatibleManifest(manifest)
  assertLibraryIdentity(manifest.libraryId, expectedLibraryId)
  return manifest
}

/** 中断恢复按即将还原的已验证清单确认身份，活动清单可能只写了一半。 */
export function assertRecoveryManifestIdentity(manifestFile: string | null, expected?: string): void {
  if (expected === undefined) return
  const manifest = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  assertLibraryIdentity(manifest?.libraryId, expected)
}
