import type { ShortcutBinding } from '@/shortcuts/types'

export function migrateShortcutBindings(
  bindings: Record<string, ShortcutBinding | null> | undefined,
): Record<string, ShortcutBinding | null> {
  if (!bindings) return {}
  const next = { ...bindings }
  if ('global.switchModule' in next && !('nav.list' in next)) {
    next['nav.list'] = next['global.switchModule'] ?? null
  }
  delete next['global.switchModule']
  delete next['view.table']
  return next
}
