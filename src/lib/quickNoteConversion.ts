import { useStore } from '@/store/useStore'

type Conversion = { awaitingViewExit: boolean }
const convertingNotes = new Map<string, Conversion>()
const noteViews = new Map<string, Set<() => boolean>>()
const listeners = new Set<() => void>()

function currentNoteKey(noteId: string): string {
  return `${useStore.getState().librarySession}:${noteId}`
}

function releaseConversion(key: string, conversion: Conversion) {
  if (convertingNotes.get(key) !== conversion) return
  convertingNotes.delete(key)
  listeners.forEach(listener => listener())
}

export function registerQuickNoteConversionView(noteId: string, ownsNavigation: () => boolean): () => void {
  const key = currentNoteKey(noteId)
  const views = noteViews.get(key) ?? new Set<() => boolean>()
  noteViews.set(key, views)
  views.add(ownsNavigation)
  return () => {
    if (!views.delete(ownsNavigation) || views.size > 0) return
    noteViews.delete(key)
    const conversion = convertingNotes.get(key)
    if (conversion?.awaitingViewExit) releaseConversion(key, conversion)
  }
}

export function subscribeQuickNoteConversions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function hasCurrentQuickNoteView(noteId: string): boolean {
  const views = noteViews.get(currentNoteKey(noteId))
  return views !== undefined && [...views].some(ownsNavigation => ownsNavigation())
}

export function isQuickNoteConverting(noteId: string): boolean {
  return convertingNotes.has(currentNoteKey(noteId))
}

/** A pending flush can outlive its view; case/live conversions share the same note lease. */
export function acquireQuickNoteConversion(noteId: string): ((awaitingViewExit?: boolean) => void) | null {
  const key = currentNoteKey(noteId)
  if (convertingNotes.has(key)) return null
  const conversion = { awaitingViewExit: false }
  convertingNotes.set(key, conversion)
  listeners.forEach(listener => listener())
  let released = false
  return (awaitingViewExit = false) => {
    if (released) return
    released = true
    conversion.awaitingViewExit = awaitingViewExit
    // 自动跳转时保留原编辑器的锁；后台完成的回执无需等待用户离页。
    if (!awaitingViewExit || !noteViews.has(key)) releaseConversion(key, conversion)
  }
}
