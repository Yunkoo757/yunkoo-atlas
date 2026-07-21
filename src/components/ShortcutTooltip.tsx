import { cloneElement, type ReactElement } from 'react'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { Tooltip, type TooltipSide } from '@/components/ui/Tooltip'
import './ShortcutTooltip.css'

export function ShortcutTooltip({
  actionId,
  label,
  children,
  /** full：标签+快捷键；shortcut：仅快捷键（可见文字已足够时用） */
  mode = 'full',
  side = 'auto',
  delay,
}: {
  actionId: string
  label?: string
  children: ReactElement
  mode?: 'full' | 'shortcut'
  side?: TooltipSide
  delay?: number
}) {
  const model = useShortcutHint(actionId, label)
  const trigger = cloneElement(children, {
    'aria-label': model.ariaLabel,
    ...(model.hint ? { 'aria-keyshortcuts': model.hint } : {}),
  } as Record<string, string>)

  const shortcutOnly = mode === 'shortcut'
  const tipLabel = shortcutOnly
    ? (model.hint ?? model.label)
    : model.ariaLabel

  return (
    <Tooltip
      asChild
      side={side}
      delay={delay}
      label={tipLabel}
      content={(
        <span className={`shortcut-tooltip-content${shortcutOnly ? ' is-shortcut-only' : ''}`}>
          {shortcutOnly ? null : <span>{model.label}</span>}
          <kbd className={!model.hint ? 'is-unset' : undefined}>{model.hint ?? '未设置'}</kbd>
        </span>
      )}
    >
      {trigger}
    </Tooltip>
  )
}
