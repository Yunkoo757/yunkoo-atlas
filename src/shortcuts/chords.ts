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

// 快照可携带未来版本的扩展属性；即使按键等效，写回时也要保留这些数据。
function storedChordsEqual(a: KeyChord, b: KeyChord): boolean {
  if (a === b) return true
  if (!chordsEqual(a, b)) return false
  const extensions = (chord: KeyChord) => Object.entries(chord).filter(
    ([key]) => key !== 'key' && key !== 'mod' && key !== 'shift' && key !== 'alt',
  )
  const left = extensions(a)
  const right = extensions(b)
  return left.length === right.length && left.every(([key, value]) =>
    right.some(([other, data]) => key === other && JSON.stringify(value) === JSON.stringify(data)),
  )
}

export function storedBindingsEqual(a: ShortcutBinding | null, b: ShortcutBinding | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (isSequence(a)) {
    return isSequence(b) && a.length === b.length && a.every((chord, index) => storedChordsEqual(chord, b[index]!))
  }
  return !isSequence(b) && storedChordsEqual(a, b)
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

/** Enter 应交给按钮、链接和表单控件，而不是开始编辑详情正文。 */
export function shouldYieldEnterToControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (typeof document !== 'undefined' && (el === document.body || el === document.documentElement)) {
    return false
  }
  const tag = el.tagName
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  return !!el.closest?.(
    'button, a, input, textarea, select, summary, [role="menu"], [role="listbox"], [role="dialog"], [role="combobox"]',
  )
}

export function eventMatchesChord(e: KeyboardEvent, chord: KeyChord): boolean {
  const c = chordFromEvent(e)
  if (!c.key) return false
  return chordsEqual(c, chord)
}
