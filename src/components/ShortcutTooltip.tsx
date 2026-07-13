import { cloneElement, type ReactElement } from 'react'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { Tooltip } from '@/components/ui/Tooltip'
import './ShortcutTooltip.css'

export function ShortcutTooltip({
  actionId,
  label,
  children,
}: {
  actionId: string
  label?: string
  children: ReactElement
}) {
  const model = useShortcutHint(actionId, label)
  const trigger = cloneElement(children, {
    'aria-label': model.ariaLabel,
    ...(model.hint ? { 'aria-keyshortcuts': model.hint } : {}),
  } as Record<string, string>)

  return (
    <Tooltip
      asChild
      label={model.ariaLabel}
      content={(
        <span className="shortcut-tooltip-content">
          <span>{model.label}</span>
          <kbd className={!model.hint ? 'is-unset' : undefined}>{model.hint ?? '未设置'}</kbd>
        </span>
      )}
    >
      {trigger}
    </Tooltip>
  )
}
