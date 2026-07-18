/** Web .journal.zip 的纯数据契约；可安全复用于浏览器与 Electron 主进程。 */
export const WEB_JOURNAL_EXPORT_VERSION = 8
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
