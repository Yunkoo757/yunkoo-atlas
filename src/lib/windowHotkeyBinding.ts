import type { KeyChord } from '@/shortcuts/types'

export const DEFAULT_WINDOW_HOTKEY: Readonly<KeyChord> = Object.freeze({ key: 'f2' })

export type WindowHotkeyErrorCode =
  | 'invalid-config'
  | 'invalid-binding'
  | 'registration-unavailable'
  | 'persistence-failed'

export type WindowHotkeyState = {
  binding: KeyChord
  registered: boolean
  errorCode?: 'invalid-config' | 'registration-unavailable'
}

export type WindowHotkeyUpdateResult =
  | { ok: true; state: WindowHotkeyState }
  | {
      ok: false
      errorCode: Exclude<WindowHotkeyErrorCode, 'invalid-config'>
      message: string
      state: WindowHotkeyState
    }

const ALLOWED_FIELDS = new Set(['mod', 'alt', 'shift', 'key'])
const FUNCTION_KEY = /^f(?:[1-9]|10)$/
const MODIFIED_KEY = /^(?:[a-z]|[0-9]|f(?:[1-9]|10))$/

export function isWindowHotkeyModifierAllowed(
  input: { ctrlKey: boolean; metaKey: boolean },
  platform: 'darwin' | 'win32',
): boolean {
  return platform === 'darwin' ? !input.ctrlKey : !input.metaKey
}

export function normalizeWindowHotkeyBinding(value: unknown): KeyChord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((field) => !ALLOWED_FIELDS.has(field))) return null
  if (typeof record.key !== 'string') return null
  for (const field of ['mod', 'alt', 'shift'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'boolean') return null
  }
  const key = record.key.toLowerCase()
  const hasModifier = record.mod === true || record.alt === true || record.shift === true
  if (!(FUNCTION_KEY.test(key) || (hasModifier && MODIFIED_KEY.test(key)))) return null
  return {
    mod: record.mod === true || undefined,
    alt: record.alt === true || undefined,
    shift: record.shift === true || undefined,
    key,
  }
}

export function toElectronAccelerator(binding: KeyChord): string {
  const normalized = normalizeWindowHotkeyBinding(binding)
  if (!normalized) throw new Error('invalid window hotkey binding')
  const parts: string[] = []
  if (normalized.mod) parts.push('CommandOrControl')
  if (normalized.alt) parts.push('Alt')
  if (normalized.shift) parts.push('Shift')
  parts.push(normalized.key.toUpperCase())
  return parts.join('+')
}
