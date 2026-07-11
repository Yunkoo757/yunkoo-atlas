import type { ReactNode } from 'react'
import './AppFrame.css'

type AppFrameProps = {
  sidebar: ReactNode
  mobileNavigation: ReactNode
  children: ReactNode
}

export function AppFrame({ sidebar, mobileNavigation, children }: AppFrameProps) {
  return (
    <div className="ui-app-frame">
      <div className="ui-desktop-sidebar">{sidebar}</div>
      <main className="ui-main-frame">{children}</main>
      <div className="ui-mobile-navigation">{mobileNavigation}</div>
    </div>
  )
}
