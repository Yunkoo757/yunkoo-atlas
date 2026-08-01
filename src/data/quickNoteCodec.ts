import type { QuickNote, QuickNoteTitleMode } from '@/data/quickNotes'

export const UNTITLED_QUICK_NOTE = '无标题随记'

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const lower = token.toLowerCase()
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : lower.startsWith('#') ? Number.parseInt(lower.slice(1), 10) : null
    if (codePoint !== null) {
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    }
    return named[lower] ?? entity
  })
}

export function textFromQuickNoteHtml(html: string): string {
  if (!html) return ''
  return decodeHtmlEntities(
    html.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

export function titleFromQuickNoteHtml(html: string): string {
  return textFromQuickNoteHtml(html).slice(0, 42) || UNTITLED_QUICK_NOTE
}

function isLikelyLegacyAutomaticTitle(title: string): boolean {
  return !title || title === UNTITLED_QUICK_NOTE || [...title].length === 1
}

function isQuickNote(value: unknown): value is QuickNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const note = value as Record<string, unknown>
  return typeof note.id === 'string' && Boolean(note.id.trim()) &&
    typeof note.title === 'string' &&
    typeof note.contentHtml === 'string' &&
    (note.titleMode === undefined || note.titleMode === 'auto' || note.titleMode === 'manual') &&
    typeof note.pinned === 'boolean' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string'
}

export function normalizeQuickNotes(value: unknown): QuickNote[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, QuickNote>()
  for (const item of value) {
    if (!isQuickNote(item)) continue
    const storedTitle = item.title.trim().slice(0, 80)
    const titleMode: QuickNoteTitleMode = item.titleMode ?? (
      isLikelyLegacyAutomaticTitle(storedTitle) ? 'auto' : 'manual'
    )
    const title = titleMode === 'auto'
      ? titleFromQuickNoteHtml(item.contentHtml)
      : storedTitle || titleFromQuickNoteHtml(item.contentHtml)
    byId.set(item.id, { ...item, title, titleMode })
  }
  return [...byId.values()].sort((left, right) => (
    Number(right.pinned) - Number(left.pinned) ||
    right.updatedAt.localeCompare(left.updatedAt)
  ))
}
