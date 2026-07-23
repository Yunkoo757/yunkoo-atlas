import { getActionMeta, SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { bindingKey } from '@/shortcuts/chords'
import type { ShortcutBinding } from '@/shortcuts/types'

export function resolveBinding(
  id: string,
  bindings: Record<string, ShortcutBinding | null>,
): ShortcutBinding | null {
  if (id in bindings) return bindings[id]
  return getActionMeta(id)?.defaultBinding ?? null
}

export function findBindingConflicts(
  actionId: string,
  binding: ShortcutBinding,
  bindings: Record<string, ShortcutBinding | null>,
): Array<{ id: string; label: string; sequenceFixed?: boolean }> {
  const key = bindingKey(binding)
  const targetScope = getActionMeta(actionId)?.scope
  const conflicts: Array<{ id: string; label: string; sequenceFixed?: boolean }> = []
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue
    if (targetScope && action.scope !== targetScope) continue
    const other = resolveBinding(action.id, bindings)
    if (!other) continue
    if (bindingKey(other) === key) {
      conflicts.push({
        id: action.id,
        label: action.label,
        sequenceFixed: action.sequenceFixed,
      })
    }
  }
  return conflicts
}

export function buildBindingOverwritePatch(
  actionId: string,
  binding: ShortcutBinding | null,
  bindings: Record<string, ShortcutBinding | null>,
): { patch: Record<string, ShortcutBinding | null>; clearedLabels: string[] } | { error: string } {
  if (binding === null) return { patch: { [actionId]: null }, clearedLabels: [] }
  const conflicts = findBindingConflicts(actionId, binding, { ...bindings, [actionId]: binding })
  const fixed = conflicts.find((conflict) => conflict.sequenceFixed)
  if (fixed) return { error: `与固定快捷键「${fixed.label}」冲突，无法覆盖` }
  const patch: Record<string, ShortcutBinding | null> = { [actionId]: binding }
  const clearedLabels: string[] = []
  for (const conflict of conflicts) {
    patch[conflict.id] = null
    clearedLabels.push(conflict.label)
  }
  return { patch, clearedLabels }
}
