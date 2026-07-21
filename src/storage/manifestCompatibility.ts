import { SCHEMA_VERSION, type LibraryManifest } from '@/storage/types'

/** 打开既有交易库时校验清单；未来 schema 必须拒写，避免静默损坏。 */
export function assertCompatibleManifest(value: LibraryManifest): void {
  const manifest = value as unknown as Record<string, unknown>
  if (
    !Number.isInteger(manifest.schemaVersion) ||
    Number(manifest.schemaVersion) < 1 ||
    typeof manifest.libraryId !== 'string' ||
    manifest.libraryId.length === 0
  ) {
    throw new Error('交易库清单无效或缺少必要字段')
  }
  if (Number(manifest.schemaVersion) > SCHEMA_VERSION) {
    throw new Error(
      `该交易库来自更新版本（v${manifest.schemaVersion}），当前版本仅支持至 v${SCHEMA_VERSION}`,
    )
  }
}
