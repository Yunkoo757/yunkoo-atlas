import type { ReactNode } from 'react'
import './Toolbar.css'

type ToolbarProps = {
  title: string
  titleAsHeading?: boolean
  context?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function Toolbar({ title, titleAsHeading = true, context, actions, children }: ToolbarProps) {
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
      {actions && <div className="ui-toolbar-actions">{actions}</div>}
    </header>
  )
}
