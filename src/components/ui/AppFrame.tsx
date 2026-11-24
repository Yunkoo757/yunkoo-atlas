import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './AppFrame.css'

export const WORKSPACE_SIDEBAR_ID = 'workspace-sidebar'

type AppFrameProps = { sidebar: ReactNode; sidebarCollapsed?: boolean; titlebar?: ReactNode; children: ReactNode }

export function AppFrame({ sidebar, sidebarCollapsed = false, titlebar, children }: AppFrameProps) {
  const sidebarRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = sidebarCollapsed
  }, [sidebarCollapsed])

  return (
    <div className={titlebar ? 'ui-app-frame with-titlebar' : 'ui-app-frame'} data-sidebar-collapsed={sidebarCollapsed || undefined}>
      {titlebar}
      <div ref={sidebarRef} id={WORKSPACE_SIDEBAR_ID} className="ui-desktop-sidebar">{sidebar}</div>
      <main id="main-content" className="ui-main-frame" tabIndex={-1}>{children}</main>
    </div>
  )
}
