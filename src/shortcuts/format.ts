import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'
import { chordKey, isSequence } from '@/shortcuts/chords'

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

function formatChord(c: KeyChord): string {
  const parts: string[] = []
  if (c.mod) parts.push(IS_MAC ? '⌘' : 'Ctrl')
  if (c.alt) parts.push(IS_MAC ? '⌥' : 'Alt')
  if (c.shift) parts.push(IS_MAC ? '⇧' : 'Shift')
  const key = c.key.length === 1 ? c.key.toUpperCase() : (KEY_LABELS[c.key] ?? c.key)
  parts.push(key)
  return parts.join(IS_MAC ? '' : '+')
}

export function formatBinding(binding: ShortcutBinding | null | undefined): string {
  if (!binding) return '—'
  if (isSequence(binding)) {
    return binding.map((c) => formatChord(c)).join(' → ')
  }
  return formatChord(binding)
}

export function formatChordKey(raw: string): string {
  const parts = raw.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const chord: KeyChord = {
    mod: mods.includes('mod') || undefined,
    alt: mods.includes('alt') || undefined,
    shift: mods.includes('shift') || undefined,
    key,
  }
  return formatChord(chord)
}
