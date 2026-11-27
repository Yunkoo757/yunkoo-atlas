import type { ShortcutBinding } from '@/shortcuts/types'
import { getActionMeta, SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { findBindingConflicts } from '@/shortcuts/bindingRules'

export function migrateShortcutBindings(
  bindings: Record<string, ShortcutBinding | null> | undefined,
): Record<string, ShortcutBinding | null> {
  if (!bindings) return {}
  const next = { ...bindings }
  if ('global.switchModule' in next && !('nav.list' in next)) {
    next['nav.list'] = next['global.switchModule'] ?? null
  }
  if ('nav.board' in next && !('view.board' in next)) {
    next['view.board'] = next['nav.board'] ?? null
  }
  delete next['global.switchModule']
  delete next['nav.today']
  delete next['nav.board']
  delete next['view.table']
  // 老资料库可能已把新增动作的出厂按键分给别的动作，优先沿用用户的绑定。
  for (const id of ['global.toggleSidebar', 'global.commandPalette', 'nav.weeklyReview']) {
    if (id in next) continue
    const defaultKey = getActionMeta(id)?.defaultBinding
    if (defaultKey && findBindingConflicts(id, defaultKey, next).some(conflict => conflict.id in next)) {
      next[id] = null
    }
  }
  const activeIds = new Set(SHORTCUT_ACTIONS.map(action => action.id))
  return Object.fromEntries(Object.entries(next).filter(([id]) => activeIds.has(id)))
}
