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
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className="ui-desktop-sidebar">{sidebar}</div>
      <main id="main-content" className="ui-main-frame" tabIndex={-1}>{children}</main>
      <div className="ui-mobile-navigation">{mobileNavigation}</div>
    </div>
  )
}
