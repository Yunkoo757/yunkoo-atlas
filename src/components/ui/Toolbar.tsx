import type { ReactNode } from 'react'
import './Toolbar.css'

type ToolbarProps = {
  title: string
  context?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function Toolbar({ title, context, actions, children }: ToolbarProps) {
  return (
    <header className="ui-toolbar">
      <div className="ui-toolbar-main">
        <div className="ui-toolbar-heading">
          <h1 className="ui-toolbar-title">{title}</h1>
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
