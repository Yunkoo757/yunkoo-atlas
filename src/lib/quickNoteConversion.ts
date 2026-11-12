type Conversion = { succeeded: boolean }
const convertingNotes = new Map<string, Conversion>()
const noteViews = new Map<string, Set<symbol>>()
const listeners = new Set<() => void>()

function releaseConversion(noteId: string, conversion: Conversion) {
  if (convertingNotes.get(noteId) !== conversion) return
  convertingNotes.delete(noteId)
  listeners.forEach(listener => listener())
}

export function registerQuickNoteConversionView(noteId: string): () => void {
  const token = Symbol(noteId)
  const views = noteViews.get(noteId) ?? new Set<symbol>()
  noteViews.set(noteId, views)
  views.add(token)
  return () => {
    if (!views.delete(token) || views.size > 0) return
    noteViews.delete(noteId)
    const conversion = convertingNotes.get(noteId)
    if (conversion?.succeeded) releaseConversion(noteId, conversion)
  }
}

export function subscribeQuickNoteConversions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isQuickNoteConverting(noteId: string): boolean {
  return convertingNotes.has(noteId)
}

/** A pending flush can outlive its view; case/live conversions share the same note lease. */
export function acquireQuickNoteConversion(noteId: string): ((succeeded?: boolean) => void) | null {
  if (convertingNotes.has(noteId)) return null
  const conversion = { succeeded: false }
  convertingNotes.set(noteId, conversion)
  listeners.forEach(listener => listener())
  let released = false
  return (succeeded = false) => {
    if (released) return
    released = true
    conversion.succeeded = succeeded
    // A successful conversion stays locked until the old editor leaves the screen.
    if (!succeeded || !noteViews.has(noteId)) releaseConversion(noteId, conversion)
  }
}
