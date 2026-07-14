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

function missingAssetPlaceholder(id: string): string {
  return `<span class="editor-missing-image" data-missing-asset-id="${id}">图片附件缺失</span>`
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

export type NoteDisplayResult = {
  html: string
  editable: boolean
}

/** 展示用：asset 引用 → blob URL，并显式报告是否可安全回写。 */
export async function resolveNoteForDisplayResult(
  html: string,
  adapter: StorageAdapter,
): Promise<NoteDisplayResult> {
  if (!html.includes(ASSET_URL_PREFIX) && !html.includes('data-asset-id')) {
    return { html, editable: true }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = doc.querySelectorAll('img[src^="journal-asset://"]')
  let editable = true

  for (const img of images) {
    const src = img.getAttribute('src') ?? ''
    const id = parseAssetId(src)
    if (!id) continue
    const url = await adapter.getAssetObjectUrl(id)
    if (url) {
      img.setAttribute('src', url)
      img.setAttribute('data-asset-id', id)
    } else {
      editable = false
      const placeholder = doc.createElement('span')
      placeholder.className = 'editor-missing-image'
      placeholder.setAttribute('data-missing-asset-id', id)
      placeholder.textContent = '图片附件缺失'
      img.replaceWith(placeholder)
    }
  }

  // 防御性处理：如果 note 中残留 blob: URL 但有 data-asset-id，
  // 尝试从存储恢复正确的 blob URL（解决刷新竞态）
  const blobImages = doc.querySelectorAll('img[data-asset-id][src^="blob:"]')
  for (const img of blobImages) {
    const id = img.getAttribute('data-asset-id')
    if (!id) continue
    const url = await adapter.getAssetObjectUrl(id)
    if (url) {
      img.setAttribute('src', url)
      // data-asset-id 已经设置，保持不变
    } else {
      editable = false
      // 资产缺失，替换为占位符（与主循环一致）
      const placeholder = doc.createElement('span')
      placeholder.className = 'editor-missing-image'
      placeholder.setAttribute('data-missing-asset-id', id)
      placeholder.textContent = '图片附件缺失'
      img.replaceWith(placeholder)
    }
  }

  return { html: doc.body.innerHTML, editable }
}

/** 兼容仅需要 HTML 的调用方。 */
export async function resolveNoteForDisplay(
  html: string,
  adapter: StorageAdapter,
): Promise<string> {
  return (await resolveNoteForDisplayResult(html, adapter)).html
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
      if (existingId) {
        // insertImageFile 已存入 IndexedDB，直接用现有 ID 建立 journal-asset:// 引用
        img.setAttribute('src', assetUrl(existingId))
        img.removeAttribute('data-asset-id')
        changed = true
      } else {
        try {
          const res = await fetch(src)
          const blob = await res.blob()
          const mime = blob.type || 'image/png'
          const id = await adapter.saveAsset(blob, mime)
          img.setAttribute('src', assetUrl(id))
          img.removeAttribute('data-asset-id')
          changed = true
        } catch {
          const placeholder = doc.createElement('img')
          placeholder.setAttribute('src', '')
          placeholder.setAttribute('alt', '图片未能保存')
          placeholder.className = 'editor-missing-image'
          placeholder.setAttribute('data-unsaved-image', 'true')
          img.replaceWith(placeholder)
          changed = true
        }
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
