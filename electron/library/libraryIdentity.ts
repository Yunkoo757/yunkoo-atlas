import fs from 'node:fs'

export class LibraryIdentityMismatchError extends Error {
  constructor() {
    super('资料库身份与已保存配置不一致，请明确选择正确的资料库')
    this.name = 'LibraryIdentityMismatchError'
  }
}

export function assertLibraryIdentity(actual: unknown, expected?: string): void {
  if (expected !== undefined && actual !== expected) throw new LibraryIdentityMismatchError()
}

/** 中断恢复按即将还原的已验证清单确认身份，活动清单可能只写了一半。 */
export function assertRecoveryManifestIdentity(manifestFile: string | null, expected?: string): void {
  if (expected === undefined) return
  const manifest = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  assertLibraryIdentity(manifest?.libraryId, expected)
}
