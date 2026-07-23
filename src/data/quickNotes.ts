import { UNTITLED_QUICK_NOTE, normalizeQuickNotes } from '@/data/quickNoteCodec'

export {
  UNTITLED_QUICK_NOTE,
  normalizeQuickNotes,
  textFromQuickNoteHtml,
  titleFromQuickNoteHtml,
} from '@/data/quickNoteCodec'

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

export function mergeQuickNotes(current: QuickNote[], imported: QuickNote[]): QuickNote[] {
  const byId = new Map(normalizeQuickNotes(current).map((note) => [note.id, note]))
  for (const note of normalizeQuickNotes(imported)) {
    if (!byId.has(note.id)) byId.set(note.id, note)
  }
  return normalizeQuickNotes([...byId.values()])
}
