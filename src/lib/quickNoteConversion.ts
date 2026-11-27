import { useStore } from '@/store/useStore'

type Conversion = { succeeded: boolean }
const convertingNotes = new Map<string, Conversion>()
const noteViews = new Map<string, Set<symbol>>()
const listeners = new Set<() => void>()

function currentNoteKey(noteId: string): string {
  return `${useStore.getState().librarySession}:${noteId}`
}

function releaseConversion(key: string, conversion: Conversion) {
  if (convertingNotes.get(key) !== conversion) return
  convertingNotes.delete(key)
  listeners.forEach(listener => listener())
}

export function registerQuickNoteConversionView(noteId: string): () => void {
  const key = currentNoteKey(noteId)
  const token = Symbol(noteId)
  const views = noteViews.get(key) ?? new Set<symbol>()
  noteViews.set(key, views)
  views.add(token)
  return () => {
    if (!views.delete(token) || views.size > 0) return
    noteViews.delete(key)
    const conversion = convertingNotes.get(key)
    if (conversion?.succeeded) releaseConversion(key, conversion)
  }
}

export function subscribeQuickNoteConversions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isQuickNoteViewOpen(noteId: string): boolean {
  return noteViews.has(currentNoteKey(noteId))
}

export function isQuickNoteConverting(noteId: string): boolean {
  return convertingNotes.has(currentNoteKey(noteId))
}

/** A pending flush can outlive its view; case/live conversions share the same note lease. */
export function acquireQuickNoteConversion(noteId: string): ((succeeded?: boolean) => void) | null {
  const key = currentNoteKey(noteId)
  if (convertingNotes.has(key)) return null
  const conversion = { succeeded: false }
  convertingNotes.set(key, conversion)
  listeners.forEach(listener => listener())
  let released = false
  return (succeeded = false) => {
    if (released) return
    released = true
    conversion.succeeded = succeeded
    // A successful conversion stays locked until the old editor leaves the screen.
    if (!succeeded || !noteViews.has(key)) releaseConversion(key, conversion)
  }
}
