import type { ReactNode } from 'react'
import './AppFrame.css'

type AppFrameProps = {
  sidebar: ReactNode
  children: ReactNode
}

export function AppFrame({ sidebar, children }: AppFrameProps) {
  return (
    <div className="ui-app-frame">
      {sidebar}
      <main className="ui-main-frame">{children}</main>
    </div>
  )
}
