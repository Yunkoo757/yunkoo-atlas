import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'

const MOD_KEYS = new Set(['control', 'meta', 'os', 'shift', 'alt', 'altgraph'])

export function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  if (k === 'esc') return 'escape'
  if (k === 'arrowleft' || k === 'left') return 'arrowleft'
  if (k === 'arrowright' || k === 'right') return 'arrowright'
  if (k === 'arrowup' || k === 'up') return 'arrowup'
  if (k === 'arrowdown' || k === 'down') return 'arrowdown'
  return k.length === 1 ? k : k
}

export function chordFromEvent(e: KeyboardEvent): KeyChord {
  const mod = e.metaKey || e.ctrlKey
  const shift = e.shiftKey
  const alt = e.altKey
  let key = normalizeKey(e.key)
  if (MOD_KEYS.has(key)) {
    key = ''
  }
  return { mod: mod || undefined, shift: shift || undefined, alt: alt || undefined, key }
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return (
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    a.key === b.key
  )
}

export function isSequence(binding: ShortcutBinding): binding is KeyChord[] {
  return Array.isArray(binding)
}

export function bindingKey(binding: ShortcutBinding): string {
  if (isSequence(binding)) {
    return binding.map(chordKey).join('>')
  }
  return chordKey(binding)
}

export function chordKey(c: KeyChord): string {
  const parts: string[] = []
  if (c.mod) parts.push('mod')
  if (c.shift) parts.push('shift')
  if (c.alt) parts.push('alt')
  parts.push(c.key)
  return parts.join('+')
}

export function parseChordKey(raw: string): KeyChord | null {
  const tokens = raw
    .toLowerCase()
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  const key = tokens[tokens.length - 1]
  const mods = tokens.slice(0, -1)
  return {
    mod: mods.includes('mod') || undefined,
    shift: mods.includes('shift') || undefined,
    alt: mods.includes('alt') || undefined,
    key: normalizeKey(key),
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[contenteditable="true"]')
}

export function eventMatchesChord(e: KeyboardEvent, chord: KeyChord): boolean {
  const c = chordFromEvent(e)
  if (!c.key) return false
  return chordsEqual(c, chord)
}
