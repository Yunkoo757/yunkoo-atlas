import type { Trade } from '@/data/trades'
import { parseAssetId, ASSET_URL_PREFIX } from '@/storage/assets'

export type DuplicateReason = 'note' | 'images' | 'note+images'

export type ContentSignature = {
  noteFp: string
  noteLen: number
  imageHashes: string[]
  imageFp: string
}

export type DuplicateMatch = {
  tradeId: string
  tradeRef: string
  reason: DuplicateReason
}

export type DuplicateGroup = {
  id: string
  reason: DuplicateReason
  keepId: string
  memberIds: string[]
}

const NOTE_STRONG_MIN = 24
const NOTE_WITH_IMAGE_MIN = 8

/** 去掉 HTML / 图片占位后的纯正文，供指纹使用 */
export function stripNoteToPlainText(html: string): string {
  if (!html) return ''
  let text = html
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/journal-asset:\/\/[^\s"'<>)]+/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

/** 同步字符串指纹（测试与正文比对） */
export function hashUtf8(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export async function hashBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data)
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function noteContentFingerprint(html: string | null | undefined): {
  fp: string
  len: number
  text: string
} {
  const text = stripNoteToPlainText(html ?? '')
  if (!text) return { fp: '', len: 0, text: '' }
  return { fp: `n:${hashUtf8(text)}`, len: text.length, text }
}

export function imageSetFingerprint(hashes: readonly string[]): string {
  const cleaned = [...hashes].filter(Boolean).sort()
  if (cleaned.length === 0) return ''
  return `i:${cleaned.join('|')}`
}

export function buildContentSignature(
  noteHtml: string | null | undefined,
  imageHashes: readonly string[] = [],
): ContentSignature {
  const note = noteContentFingerprint(noteHtml)
  const hashes = [...imageHashes].filter(Boolean)
  return {
    noteFp: note.fp,
    noteLen: note.len,
    imageHashes: hashes,
    imageFp: imageSetFingerprint(hashes),
  }
}

export function duplicateReason(
  a: ContentSignature,
  b: ContentSignature,
): DuplicateReason | null {
  const strongNote =
    Boolean(a.noteFp) &&
    a.noteFp === b.noteFp &&
    a.noteLen >= NOTE_STRONG_MIN &&
    b.noteLen >= NOTE_STRONG_MIN

  const sameImages =
    Boolean(a.imageFp) && a.imageFp === b.imageFp && a.imageHashes.length > 0

  if (strongNote && sameImages) return 'note+images'
  if (strongNote) return 'note'
  if (sameImages && a.imageHashes.length >= 2) return 'images'
  if (
    sameImages &&
    a.imageHashes.length >= 1 &&
    Boolean(a.noteFp) &&
    a.noteFp === b.noteFp &&
    a.noteLen >= NOTE_WITH_IMAGE_MIN &&
    b.noteLen >= NOTE_WITH_IMAGE_MIN
  ) {
    return 'note+images'
  }
  return null
}

export function findObviousDuplicate(
  candidate: ContentSignature,
  library: ReadonlyArray<{ id: string; ref: string; sig: ContentSignature }>,
): DuplicateMatch | null {
  for (const item of library) {
    const reason = duplicateReason(candidate, item.sig)
    if (reason) {
      return { tradeId: item.id, tradeRef: item.ref, reason }
    }
  }
  return null
}

export function extractAssetIdsFromNote(html: string): string[] {
  if (!html.includes(ASSET_URL_PREFIX) && !html.includes('attachment:')) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/(?:journal-asset:\/\/|attachment:)\/?([^\s"'<)]+)/g)) {
    const id = match[1]?.replace(/\/$/, '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  // 亦兼容 data-asset-id
  for (const match of html.matchAll(/data-asset-id=["']([^"']+)["']/g)) {
    const id = match[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function hashImageFiles(
  files: ReadonlyArray<{ data: ArrayBuffer | Uint8Array }>,
): Promise<string[]> {
  const hashes: string[] = []
  for (const file of files) {
    hashes.push(await hashBytes(file.data))
  }
  return hashes
}

export async function signatureFromTradeNoteAssets(
  trade: Pick<Trade, 'note'>,
  loadAssetBase64: (assetId: string) => Promise<string | null>,
): Promise<ContentSignature> {
  const assetIds = extractAssetIdsFromNote(trade.note ?? '')
  const hashes: string[] = []
  for (const id of assetIds) {
    const data = await loadAssetBase64(id)
    if (!data) continue
    hashes.push(await hashBytes(base64ToBytes(data)))
  }
  return buildContentSignature(trade.note, hashes)
}

function preferKeepTrade(
  a: Pick<Trade, 'id' | 'recordedAt' | 'openedAt'>,
  b: Pick<Trade, 'id' | 'recordedAt' | 'openedAt'>,
): number {
  const aTime = a.recordedAt || a.openedAt || ''
  const bTime = b.recordedAt || b.openedAt || ''
  if (aTime !== bTime) return aTime < bTime ? 1 : -1
  return a.id < b.id ? 1 : -1
}

/** 在已签名的交易中找出明显重复组（组内保留较新的一条） */
export function groupObviousDuplicates(
  items: ReadonlyArray<{ trade: Pick<Trade, 'id' | 'ref' | 'recordedAt' | 'openedAt'>; sig: ContentSignature }>,
): DuplicateGroup[] {
  const parent = new Map<string, string>()
  const reasonByRoot = new Map<string, DuplicateReason>()

  const find = (id: string): string => {
    const p = parent.get(id) ?? id
    if (p !== id) {
      const root = find(p)
      parent.set(id, root)
      return root
    }
    return id
  }
  const union = (a: string, b: string, reason: DuplicateReason) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    parent.set(rb, ra)
    const prev = reasonByRoot.get(ra)
    if (!prev || (prev === 'note' && reason !== 'note') || reason === 'note+images') {
      reasonByRoot.set(ra, reason)
    }
  }

  for (const item of items) parent.set(item.trade.id, item.trade.id)

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const left = items[i]!
      const right = items[j]!
      const reason = duplicateReason(left.sig, right.sig)
      if (reason) union(left.trade.id, right.trade.id, reason)
    }
  }

  const buckets = new Map<
    string,
    Array<{ trade: Pick<Trade, 'id' | 'ref' | 'recordedAt' | 'openedAt'>; sig: ContentSignature }>
  >()
  for (const item of items) {
    const root = find(item.trade.id)
    const list = buckets.get(root) ?? []
    list.push(item)
    buckets.set(root, list)
  }

  const groups: DuplicateGroup[] = []
  for (const [root, members] of buckets) {
    if (members.length < 2) continue
    const sorted = [...members].sort((a, b) => preferKeepTrade(a.trade, b.trade))
    const keep = sorted[0]!
    groups.push({
      id: root,
      reason: reasonByRoot.get(root) ?? 'note',
      keepId: keep.trade.id,
      memberIds: sorted.map((m) => m.trade.id),
    })
  }
  return groups
}

export function duplicateReasonLabel(reason: DuplicateReason): string {
  if (reason === 'note') return '正文相同'
  if (reason === 'images') return '截图相同'
  return '正文与截图相同'
}

export async function buildLibraryContentIndex(
  trades: ReadonlyArray<Trade>,
  loadAssetBase64: (assetId: string) => Promise<string | null>,
): Promise<Array<{ id: string; ref: string; sig: ContentSignature }>> {
  const active = trades.filter((trade) => !trade.deletedAt)
  const out: Array<{ id: string; ref: string; sig: ContentSignature }> = []
  for (const trade of active) {
    out.push({
      id: trade.id,
      ref: trade.ref,
      sig: await signatureFromTradeNoteAssets(trade, loadAssetBase64),
    })
  }
  return out
}

/** @deprecated internal helper kept for call sites that already have parseAssetId */
export function isAssetSrc(src: string): boolean {
  return parseAssetId(src) !== null
}
