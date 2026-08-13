import type { ReactNode } from 'react'
import { useStore } from '@/store/useStore'
import './AppFrame.css'

type AppFrameProps = {
  sidebar: ReactNode
  children: ReactNode
}

export function AppFrame({ sidebar, children }: AppFrameProps) {
  const showKeyboardFocusRings = useStore(
    (state) => state.display.showKeyboardFocusRings,
  )

  return (
    <div
      className="ui-app-frame"
      data-keyboard-focus-rings={showKeyboardFocusRings ? 'on' : 'off'}
    >
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className="ui-desktop-sidebar">{sidebar}</div>
      <main id="main-content" className="ui-main-frame" tabIndex={-1}>{children}</main>
    </div>
  )
}
