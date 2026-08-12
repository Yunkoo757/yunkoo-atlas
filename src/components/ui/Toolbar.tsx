import type { ReactNode } from 'react'
import { MoreHorizontal } from '@/icons/appIcons'
import { Menu } from '@/components/Menu'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import './Toolbar.css'

export type ToolbarOverflowAction = {
  value: string
  label: string
  icon?: ReactNode
  onSelect: () => void
}

type ToolbarProps = {
  title: string
  titleAsHeading?: boolean
  context?: ReactNode
  actions?: ReactNode
  overflowActions?: ToolbarOverflowAction[]
  children?: ReactNode
}

export function Toolbar({
  title,
  titleAsHeading = true,
  context,
  actions,
  overflowActions = [],
  children,
}: ToolbarProps) {
  return (
    <header className="ui-toolbar">
      <div className="ui-toolbar-main">
        <div className="ui-toolbar-heading">
          {titleAsHeading ? (
            <h1 className="ui-toolbar-title">{title}</h1>
          ) : (
            <span className="ui-toolbar-title">{title}</span>
          )}
          {context ? (
            <>
              <span className="ui-toolbar-sep" aria-hidden="true" />
              <span className="ui-toolbar-context">{context}</span>
            </>
          ) : null}
        </div>
        {children && <div className="ui-toolbar-content">{children}</div>}
      </div>
      {(actions || overflowActions.length > 0) && (
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
                      <MoreHorizontal size={16} aria-hidden />
                    </IconButton>
                  )}
                  options={overflowActions.map(({ value, label, icon }) => ({ value, label, icon }))}
                  onSelect={(value) => overflowActions.find((action) => action.value === value)?.onSelect()}
                />
              </div>
            </>
          ) : null}
        </div>
      )}
    </header>
  )
}
