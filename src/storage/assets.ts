import type { StorageAdapter } from '@/storage/adapter'

export const ASSET_URL_PREFIX = 'journal-asset://'

const DATA_URL_IMG_RE =
  /<img([^>]*)\ssrc=["'](data:image\/[^"']+)["']([^>]*)>/gi
const ASSET_IMG_RE =
  /<img([^>]*)\ssrc=["']journal-asset:\/\/([^"']+)["']([^>]*)>/gi

export function assetUrl(id: string): string {
  return `${ASSET_URL_PREFIX}${id}`
}

export function parseAssetId(src: string): string | null {
  if (!src.startsWith(ASSET_URL_PREFIX)) return null
  const id = src.slice(ASSET_URL_PREFIX.length)
  return id || null
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const mime = match[1]
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { blob: new Blob([bytes], { type: mime }), mime }
}

/** 将 note 内 base64 图片外置为 asset 引用 */
export async function externalizeNoteImages(
  html: string,
  adapter: StorageAdapter,
): Promise<string> {
  if (!html.includes('data:image/')) return html

  const parts: string[] = []
  let last = 0
  let match: RegExpExecArray | null

  DATA_URL_IMG_RE.lastIndex = 0
  while ((match = DATA_URL_IMG_RE.exec(html)) !== null) {
    parts.push(html.slice(last, match.index))
    const parsed = dataUrlToBlob(match[2])
    if (parsed) {
      const id = await adapter.saveAsset(parsed.blob, parsed.mime)
      parts.push(`<img${match[1]} src="${assetUrl(id)}"${match[3]}>`)
    } else {
      parts.push(match[0])
    }
    last = match.index + match[0].length
  }
  parts.push(html.slice(last))
  return parts.join('')
}

/** 展示用：asset 引用 → blob URL */
export async function resolveNoteForDisplay(
  html: string,
  adapter: StorageAdapter,
): Promise<string> {
  if (!html.includes(ASSET_URL_PREFIX)) return html

  const parts: string[] = []
  let last = 0
  let match: RegExpExecArray | null

  ASSET_IMG_RE.lastIndex = 0
  while ((match = ASSET_IMG_RE.exec(html)) !== null) {
    parts.push(html.slice(last, match.index))
    const id = match[2]
    const url = await adapter.getAssetObjectUrl(id)
    if (url) {
      parts.push(`<img${match[1]} src="${url}" data-asset-id="${id}"${match[3]}>`)
    } else {
      parts.push(match[0])
    }
    last = match.index + match[0].length
  }
  parts.push(html.slice(last))
  return parts.join('')
}

/** 持久化用：blob URL / 新粘贴 → asset 引用 */
export async function normalizeNoteForStorage(
  html: string,
  adapter: StorageAdapter,
): Promise<string> {
  if (!html.includes('<img')) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = doc.querySelectorAll('img')
  let changed = false

  for (const img of images) {
    const src = img.getAttribute('src') ?? ''
    const existingId = img.getAttribute('data-asset-id')

    if (src.startsWith(ASSET_URL_PREFIX)) {
      img.removeAttribute('data-asset-id')
      changed = true
      continue
    }

    if (existingId && !src.startsWith('blob:') && !src.startsWith('data:')) {
      img.setAttribute('src', assetUrl(existingId))
      img.removeAttribute('data-asset-id')
      changed = true
      continue
    }

    if (src.startsWith('data:image/')) {
      const parsed = dataUrlToBlob(src)
      if (parsed) {
        const id = await adapter.saveAsset(parsed.blob, parsed.mime)
        img.setAttribute('src', assetUrl(id))
        img.removeAttribute('data-asset-id')
        changed = true
      }
      continue
    }

    if (src.startsWith('blob:')) {
      try {
        const res = await fetch(src)
        const blob = await res.blob()
        const mime = blob.type || 'image/png'
        const id = existingId ?? (await adapter.saveAsset(blob, mime))
        img.setAttribute('src', assetUrl(id))
        img.removeAttribute('data-asset-id')
        changed = true
      } catch {
        /* keep as-is */
      }
    }
  }

  return changed ? doc.body.innerHTML : html
}

export function collectAssetIdsFromNotes(trades: { note: string }[]): string[] {
  const ids = new Set<string>()
  for (const t of trades) {
    if (!t.note.includes(ASSET_URL_PREFIX)) continue
    let match: RegExpExecArray | null
    const re = /journal-asset:\/\/([^"'\s>]+)/g
    while ((match = re.exec(t.note)) !== null) {
      ids.add(match[1])
    }
  }
  return [...ids]
}
