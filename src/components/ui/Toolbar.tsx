import { ICON_MD } from '@/icons/iconSize'
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from '@/icons/appIcons'
import { Menu } from '@/components/Menu'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { OverflowTooltip } from '@/components/ui/Tooltip'
import './Toolbar.css'

export const WindowToolbarHost = createContext<HTMLDivElement | null>(null)

export type ToolbarOverflowAction = {
  value: string
  label: string
  icon?: ReactNode
  onSelect: () => void
}

type ToolbarProps = {
  title: string
  titleAsHeading?: boolean
  titleTooltip?: boolean
  context?: ReactNode
  actions?: ReactNode
  overflowActions?: ToolbarOverflowAction[]
  children?: ReactNode
}

export function Toolbar({
  title,
  titleAsHeading = true,
  titleTooltip = false,
  context,
  actions,
  overflowActions = [],
  children,
}: ToolbarProps) {
  const titleElement = titleAsHeading
    ? <h1 className="ui-toolbar-title">{title}</h1>
    : <span className="ui-toolbar-title">{title}</span>
  const windowHost = useContext(WindowToolbarHost)
  const controls = (actions || overflowActions.length > 0) && (
    <div className="ui-toolbar-actions">
      {actions}
      {overflowActions.length > 0 ? (
        <>
          <div className="ui-toolbar-overflow-wide">
            {overflowActions.map((action) => (
              <Button
                key={action.value}
                variant="ghost"
                size="sm"
                onClick={action.onSelect}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
          <div className="ui-toolbar-overflow-compact">
            <Menu
              align="right"
              trigger={(
                <IconButton label="更多操作" size="sm">
                  <MoreHorizontal size={ICON_MD} aria-hidden />
                </IconButton>
              )}
              options={overflowActions.map(({ value, label, icon }) => ({ value, label, icon }))}
              onSelect={(value) => overflowActions.find((action) => action.value === value)?.onSelect()}
            />
          </div>
        </>
      ) : null}
    </div>
  )
  const content = children && <div className="ui-toolbar-content">{children}</div>
  const detail = context && <span className="ui-toolbar-context">{context}</span>
  if (windowHost) return createPortal(<>{detail}{content}{controls}</>, windowHost)

  return (
    <header className="ui-toolbar">
      <div className="ui-toolbar-main">
        <div className="ui-toolbar-heading">
          {titleTooltip ? <OverflowTooltip text={title}>{titleElement}</OverflowTooltip> : titleElement}
          {detail}
        </div>
        {content}
      </div>
      {controls}
    </header>
  )
}
