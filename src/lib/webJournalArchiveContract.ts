import { isSafeAssetId } from '../storage/assetId'
import { htmlAssetIds, snapshotRichTextRecords } from '../storage/snapshotRichText'
import { SCHEMA_VERSION, type PersistedSnapshot } from '../storage/types'

/** Web .journal.zip 的纯数据契约；可安全复用于浏览器与 Electron 主进程。 */
export const WEB_JOURNAL_EXPORT_VERSION = 9
export const MAX_WEB_JOURNAL_ARCHIVE_BYTES = 128 * 1024 * 1024
export const MAX_WEB_JOURNAL_ENTRY_COUNT = 10_000
export const MAX_WEB_JOURNAL_EXPANDED_BYTES = 256 * 1024 * 1024
export const MAX_WEB_JOURNAL_ENTRY_BYTES = 32 * 1024 * 1024

const MIME_EXTENSIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/webp': new Set(['webp']),
  'image/gif': new Set(['gif']),
  'image/svg+xml': new Set(['svg']),
  'image/bmp': new Set(['bmp']),
  'image/avif': new Set(['avif']),
  'image/heic': new Set(['heic']),
  'image/heif': new Set(['heif']),
  'image/tiff': new Set(['tif', 'tiff']),
  'image/jxl': new Set(['jxl']),
  'image/x-icon': new Set(['ico']),
  'image/vnd.microsoft.icon': new Set(['ico']),
}

const FALLBACK_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['bin'])
const EMPTY_EXTENSIONS: ReadonlySet<string> = new Set()
const SAFE_IMAGE_MIME_RE = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/

export function normalizeWebJournalImageMime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return SAFE_IMAGE_MIME_RE.test(normalized) ? normalized : null
}

export function webJournalExtensionsForMime(value: unknown): ReadonlySet<string> {
  const mime = normalizeWebJournalImageMime(value)
  if (!mime) return EMPTY_EXTENSIONS
  return MIME_EXTENSIONS[mime] ?? FALLBACK_IMAGE_EXTENSIONS
}

export function webJournalExtensionForMime(value: unknown): string | null {
  return webJournalExtensionsForMime(value).values().next().value ?? null
}

export type WebJournalArchiveErrorCode =
  | 'not-zip'
  | 'archive-too-large'
  | 'too-many-entries'
  | 'entry-too-large'
  | 'expanded-too-large'
  | 'desktop-format-not-supported-on-web'
  | 'unsafe-path'
  | 'unsupported-entry'
  | 'incompatible-version'
  | 'invalid-snapshot'
  | 'invalid-asset'

export class WebJournalArchiveError extends Error {
  readonly code: WebJournalArchiveErrorCode

  constructor(code: WebJournalArchiveErrorCode, message: string) {
    super(message)
    this.name = 'WebJournalArchiveError'
    this.code = code
  }
}

type ArchiveReader = 'web' | 'desktop'

function rejectInput(
  reader: ArchiveReader,
  code: 'incompatible-version' | 'invalid-asset',
  webMessage: string,
  desktopMessage: string,
): never {
  if (reader === 'desktop') throw new Error(desktopMessage)
  throw new WebJournalArchiveError(code, webMessage)
}

export function readWebJournalVersions(raw: Record<string, unknown>, reader: ArchiveReader) {
  const { version, schemaVersion } = raw
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    rejectInput(reader, 'incompatible-version', 'data.json 缺少有效的导出版本',
      'Invalid .journal.zip: data.json is missing a valid export version')
  }
  if (version > WEB_JOURNAL_EXPORT_VERSION) {
    rejectInput(reader, 'incompatible-version',
      `该归档来自更新版本（v${version}），当前仅支持至 v${WEB_JOURNAL_EXPORT_VERSION}`,
      `该 Web 归档来自更新版本（v${version}），当前仅支持至 v${WEB_JOURNAL_EXPORT_VERSION}`)
  }
  if (schemaVersion === undefined) return { exportVersion: version, schemaVersion: null }
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    rejectInput(reader, 'incompatible-version', 'data.json 中的交易库版本无效',
      'Invalid .journal.zip: data.json contains an invalid schema version')
  }
  if (schemaVersion > SCHEMA_VERSION) {
    rejectInput(reader, 'incompatible-version',
      `该交易库来自更新版本（v${schemaVersion}），当前仅支持至 v${SCHEMA_VERSION}`,
      `该 Web 归档的资料库来自更新版本（v${schemaVersion}），当前仅支持至 v${SCHEMA_VERSION}`)
  }
  return { exportVersion: version, schemaVersion }
}

export function readWebJournalAssetDeclarations(value: unknown, reader: ArchiveReader): Map<string, string> {
  const declarations = new Map<string, string>()
  if (value === undefined) return declarations
  if (!Array.isArray(value)) {
    rejectInput(reader, 'invalid-asset', 'data.json 中的附件声明必须是数组',
      'Invalid .journal.zip: data.json assets must be an array')
  }
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !isSafeAssetId(item.id)) {
      rejectInput(reader, 'invalid-asset', 'data.json 中存在非法附件 ID',
        'Invalid .journal.zip: data.json contains an invalid asset id')
    }
    const mime = normalizeWebJournalImageMime(item.mime)
    if (!mime) {
      rejectInput(reader, 'invalid-asset', `附件 ${item.id} 使用了不支持的图片类型`,
        `Invalid .journal.zip: asset ${item.id} has an invalid image MIME type`)
    }
    if (declarations.has(item.id)) {
      rejectInput(reader, 'invalid-asset', `data.json 中存在重复附件声明：${item.id}`,
        `Invalid .journal.zip: duplicate asset declaration (${item.id})`)
    }
    declarations.set(item.id, mime)
  }
  return declarations
}

export function validateWebJournalAssetReferences(
  snapshot: PersistedSnapshot,
  declarations: ReadonlyMap<string, string>,
  allowedUnreferencedIds: ReadonlySet<string>,
  reader: ArchiveReader,
): Set<string> {
  const referenced = new Set<string>()
  for (const source of snapshotRichTextRecords(snapshot)) {
    for (const id of htmlAssetIds(source.html)) {
      const valid = isSafeAssetId(id)
      if (valid && declarations.has(id)) {
        referenced.add(id)
        continue
      }
      let webOwner: string
      let desktopOwner: string
      switch (source.domain) {
        case 'trade':
          webOwner = `记录 ${source.record.ref || source.record.id}`
          desktopOwner = `trade ${source.record.ref || source.record.id}`
          break
        case 'weeklyReview':
          webOwner = `周复盘 ${source.record.weekStart}`
          desktopOwner = `weekly review ${source.record.weekStart}`
          break
        case 'quickNote':
          webOwner = `随记「${source.record.title}」`
          desktopOwner = `quick note ${source.record.id}`
          break
      }
      if (!valid) {
        rejectInput(reader, 'invalid-asset', `${webOwner} 引用了非法附件`,
          `Invalid .journal.zip: ${desktopOwner} references an invalid asset`)
      }
      const webProblem = source.domain === 'trade' ? '未声明或缺失' : '缺失'
      const desktopProblem = source.domain === 'trade' ? `an undeclared asset (${id})` : `missing asset ${id}`
      rejectInput(reader, 'invalid-asset', `${webOwner} 引用了${webProblem}的附件：${id}`,
        `Invalid .journal.zip: ${desktopOwner} references ${desktopProblem}`)
    }
  }
  for (const id of declarations.keys()) {
    if (!referenced.has(id) && !allowedUnreferencedIds.has(id)) {
      rejectInput(reader, 'invalid-asset', `附件 ${id} 已声明但未被任何正文引用`,
        `Invalid .journal.zip: asset ${id} 未被任何交易正文引用`)
    }
  }
  return referenced
}
