import { getActionMeta, SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { bindingKey } from '@/shortcuts/chords'
import type { ShortcutBinding, ShortcutScope } from '@/shortcuts/types'

export const SHORTCUT_SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: '全局', navigation: '全局导航', list: '列表 / 看板',
  judgmentDesk: '判断台', detail: '交易 / 案例详情', reviewSession: '随机复盘', lightbox: '图片查看器', overlay: '弹层',
}

/** 页面之间可复用按键；全局与导航始终与普通页面同时生效。 */
export function shortcutScopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true
  if (a === 'lightbox' || b === 'lightbox' || a === 'overlay' || b === 'overlay') return false
  return a === 'global' || b === 'global' || a === 'navigation' || b === 'navigation'
}

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
    if (targetScope && !shortcutScopesOverlap(action.scope, targetScope)) continue
    const other = resolveBinding(action.id, bindings)
    if (!other) continue
    if (bindingKey(other) === key) {
      conflicts.push({
        id: action.id,
        label: `${SHORTCUT_SCOPE_LABELS[action.scope]} · ${action.label}`,
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
