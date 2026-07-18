export const UNTITLED_QUICK_NOTE = '无标题随记'

export interface QuickNote {
  id: string
  title: string
  contentHtml: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `quick-note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createQuickNote(now = new Date()): QuickNote {
  const timestamp = now.toISOString()
  return {
    id: createId(),
    title: UNTITLED_QUICK_NOTE,
    contentHtml: '',
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function textFromQuickNoteHtml(html: string): string {
  if (!html) return ''
  if (typeof document !== 'undefined') {
    const container = document.createElement('div')
    container.innerHTML = html
    return (container.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  return html
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleFromQuickNoteHtml(html: string): string {
  return textFromQuickNoteHtml(html).slice(0, 42) || UNTITLED_QUICK_NOTE
}

function isQuickNote(value: unknown): value is QuickNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const note = value as Record<string, unknown>
  return typeof note.id === 'string' && Boolean(note.id.trim()) &&
    typeof note.title === 'string' &&
    typeof note.contentHtml === 'string' &&
    typeof note.pinned === 'boolean' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string'
}

export function normalizeQuickNotes(value: unknown): QuickNote[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, QuickNote>()
  for (const item of value) {
    if (!isQuickNote(item)) continue
    const title = item.title.trim().slice(0, 80) || titleFromQuickNoteHtml(item.contentHtml)
    byId.set(item.id, { ...item, title })
  }
  return [...byId.values()].sort((left, right) => (
    Number(right.pinned) - Number(left.pinned) ||
    right.updatedAt.localeCompare(left.updatedAt)
  ))
}

export function mergeQuickNotes(current: QuickNote[], imported: QuickNote[]): QuickNote[] {
  const byId = new Map(normalizeQuickNotes(current).map((note) => [note.id, note]))
  for (const note of normalizeQuickNotes(imported)) {
    if (!byId.has(note.id)) byId.set(note.id, note)
  }
  return normalizeQuickNotes([...byId.values()])
}
