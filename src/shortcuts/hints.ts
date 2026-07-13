import { getActionMeta } from '@/shortcuts/actions'
import { formatBinding } from '@/shortcuts/format'
import type { ShortcutBinding } from '@/shortcuts/types'
import { resolveBinding } from '@/store/shortcutStore'

export interface ShortcutHintModel {
  label: string
  hint: string | null
  ariaLabel: string
}

/** 快捷键提示的唯一文案模型；禁用绑定时绝不回退到默认键。 */
export function getShortcutHintModel(
  actionId: string,
  bindings: Record<string, ShortcutBinding | null>,
  labelOverride?: string,
): ShortcutHintModel {
  const label = labelOverride ?? getActionMeta(actionId)?.label ?? actionId
  const binding = resolveBinding(actionId, bindings)
  const hint = binding ? formatBinding(binding) : null
  return {
    label,
    hint,
    ariaLabel: hint ? `${label}（${hint}）` : `${label}（未设置快捷键）`,
  }
}
