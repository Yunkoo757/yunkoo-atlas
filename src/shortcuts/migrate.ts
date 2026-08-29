import type { ShortcutBinding } from '@/shortcuts/types'

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
  return next
}
