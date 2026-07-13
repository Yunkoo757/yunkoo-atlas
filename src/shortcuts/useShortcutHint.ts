import { getShortcutHintModel } from '@/shortcuts/hints'
import { useShortcutStore } from '@/store/shortcutStore'

export function useShortcutHint(actionId: string, labelOverride?: string) {
  const bindings = useShortcutStore((state) => state.bindings)
  return getShortcutHintModel(actionId, bindings, labelOverride)
}
