import type { Trade } from '@/data/trades'
import { textFromQuickNoteHtml, type QuickNote } from '@/data/quickNotes'

export type CommandSearchEntry<T> = { value: T; text: string }

// Store updates replace records. Weak keys release removed records and let a single
// edited record invalidate its own text without reparsing every unchanged note.
const tradeText = new WeakMap<Trade, { strategyName: string; entry: CommandSearchEntry<Trade> }>()
const noteText = new WeakMap<QuickNote, CommandSearchEntry<QuickNote>>()

export function indexCommandTrade(trade: Trade, strategyName: string): CommandSearchEntry<Trade> {
  const cached = tradeText.get(trade)
  if (cached?.strategyName === strategyName) return cached.entry
  const entry = {
    value: trade,
    text: [trade.ref, trade.symbol, strategyName, trade.tags.join(' '), textFromQuickNoteHtml(trade.note)]
      .filter(Boolean).join(' ').toLowerCase(),
  }
  tradeText.set(trade, { strategyName, entry })
  return entry
}

export function indexCommandNote(note: QuickNote): CommandSearchEntry<QuickNote> {
  const cached = noteText.get(note)
  if (cached) return cached
  const entry = {
    value: note,
    text: [note.title, textFromQuickNoteHtml(note.contentHtml)].filter(Boolean).join(' ').toLowerCase(),
  }
  noteText.set(note, entry)
  return entry
}

/** Preserve all matches and source order; the dialog only projects its visible batch. */
export function findIndexedCommandMatches<T>(entries: readonly CommandSearchEntry<T>[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  return entries.filter((entry) => tokens.every((token) => entry.text.includes(token))).map((entry) => entry.value)
}
