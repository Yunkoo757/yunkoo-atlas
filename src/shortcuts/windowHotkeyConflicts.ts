import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { bindingKey } from '@/shortcuts/chords'
import { resolveBinding } from '@/shortcuts/bindingRules'
import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'

export function findWindowHotkeyConflicts(
  binding: KeyChord,
  bindings: Record<string, ShortcutBinding | null>,
): Array<{ id: string; label: string }> {
  const target = bindingKey(binding)
  return SHORTCUT_ACTIONS.flatMap((action) => {
    const active = resolveBinding(action.id, bindings)
    return active && bindingKey(active) === target ? [{ id: action.id, label: action.label }] : []
  })
}

export function disableWindowHotkeyConflicts(
  binding: KeyChord,
  bindings: Record<string, ShortcutBinding | null>,
): { bindings: Record<string, ShortcutBinding | null>; clearedLabels: string[] } {
  const conflicts = findWindowHotkeyConflicts(binding, bindings)
  const next = { ...bindings }
  for (const conflict of conflicts) next[conflict.id] = null
  return { bindings: next, clearedLabels: conflicts.map((conflict) => conflict.label) }
}
