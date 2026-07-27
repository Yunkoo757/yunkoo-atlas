export interface PresenceWindowCloseEvent {
  preventDefault(): void
}

export interface PresenceWindow {
  isVisible(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  isDestroyed(): boolean
  restore(): void
  show(): void
  focus(): void
  hide(): void
  on(event: 'close', listener: (event: PresenceWindowCloseEvent) => void): void
  removeListener(event: 'close', listener: (event: PresenceWindowCloseEvent) => void): void
}

export interface PresenceTray {
  refreshMenu(windowVisible: boolean): void
  dispose(): void
}

export interface PresenceTrayActions {
  toggle(): void
  show(): void
  hide(): void
  quit(): void
}

export interface ElectronTrayMenuItem {
  label?: string
  type?: 'separator'
  enabled?: boolean
  click?(): void
}

export interface ElectronTrayAdapter {
  on(event: 'click', listener: () => void): void
  setContextMenu(menu: unknown): void
  destroy(): void
}

export interface ElectronTrayFactoryDependencies {
  createTray(): ElectronTrayAdapter
  buildMenu(items: readonly ElectronTrayMenuItem[]): unknown
}

export type PresenceTrayFactory = (actions: PresenceTrayActions) => PresenceTray

export function createElectronTrayFactory(
  dependencies: ElectronTrayFactoryDependencies,
): PresenceTrayFactory {
  return (actions) => {
    const tray = dependencies.createTray()
    tray.on('click', actions.toggle)
    return {
      refreshMenu(windowVisible) {
        tray.setContextMenu(dependencies.buildMenu([
          {
            label: '显示 Trader Atlas',
            enabled: !windowVisible,
            click: actions.show,
          },
          {
            label: '隐藏 Trader Atlas',
            enabled: windowVisible,
            click: actions.hide,
          },
          { type: 'separator' },
          {
            label: '彻底退出 Trader Atlas',
            click: actions.quit,
          },
        ]))
      },
      dispose() {
        tray.destroy()
      },
    }
  }
}

export type PresenceQuitResult =
  | { ok: true }
  | { ok: false; error?: string }

export interface WindowPresenceDependencies {
  ensureWindow(): PresenceWindow
  getWindow(): PresenceWindow | null
  createTray(actions: PresenceTrayActions): PresenceTray
  requestQuit(): Promise<PresenceQuitResult>
  isExitAuthorized(): boolean
  showDock(): void
  hideDock(): void
  reportError(code: string, error: unknown): void
}

export class WindowPresenceController {
  private tray: PresenceTray | null = null
  private attachedWindow: PresenceWindow | null = null
  private disposed = false
  private readonly closeListener = (event: PresenceWindowCloseEvent): void => {
    if (this.dependencies.isExitAuthorized()) return
    event.preventDefault()
    if (this.tray) {
      this.hide()
      return
    }
    void this.requestQuitAndRecover()
  }

  constructor(private readonly dependencies: WindowPresenceDependencies) {}

  initialize(): boolean {
    if (this.disposed) return false
    if (this.tray) return true
    let createdTray: PresenceTray | null = null
    try {
      createdTray = this.dependencies.createTray({
        toggle: () => this.toggle(),
        show: () => this.show(),
        hide: () => this.hide(),
        quit: () => { void this.requestQuitAndRecover() },
      })
      this.tray = createdTray
      return this.refreshTrayMenu(undefined, false)
    } catch (error) {
      this.tray = null
      try {
        createdTray?.dispose()
      } catch (disposeError) {
        this.dependencies.reportError('tray-dispose-failed', disposeError)
      }
      this.dependencies.reportError('tray-create-failed', error)
      return false
    }
  }

  toggle(): void {
    if (this.disposed) return
    const window = this.dependencies.ensureWindow()
    if (window.isVisible() && window.isFocused() && !window.isMinimized()) {
      this.hide()
      return
    }
    this.show()
  }

  attachWindow(window: PresenceWindow): void {
    if (this.disposed) return
    if (this.attachedWindow === window) return
    this.attachedWindow?.removeListener('close', this.closeListener)
    this.attachedWindow = window
    window.on('close', this.closeListener)
  }

  show(): void {
    if (this.disposed) return
    const window = this.dependencies.ensureWindow()
    if (window.isMinimized()) window.restore()
    this.dependencies.showDock()
    window.show()
    window.focus()
    this.refreshTrayMenu()
  }

  hide(): void {
    if (this.disposed) return
    const window = this.dependencies.getWindow()
    if (!this.tray || !window || window.isDestroyed()) return
    if (!this.refreshTrayMenu(false)) return
    window.hide()
    this.dependencies.hideDock()
  }

  dispose(): void {
    if (this.disposed) return
    this.tray?.dispose()
    this.disposed = true
    this.attachedWindow?.removeListener('close', this.closeListener)
    this.attachedWindow = null
    this.tray = null
  }

  private refreshTrayMenu(windowVisible?: boolean, recoverWindow = true): boolean {
    const window = this.dependencies.getWindow()
    try {
      this.tray?.refreshMenu(windowVisible ?? Boolean(window && !window.isDestroyed() && window.isVisible()))
      return true
    } catch (error) {
      const tray = this.tray
      this.tray = null
      try { tray?.dispose() } catch (disposeError) {
        this.dependencies.reportError('tray-dispose-failed', disposeError)
      }
      this.dependencies.reportError(recoverWindow ? 'tray-refresh-failed' : 'tray-create-failed', error)
      if (!recoverWindow) return false
      try {
        const recover = this.dependencies.ensureWindow()
        this.dependencies.showDock()
        recover.show()
        recover.focus()
      } catch (showError) {
        this.dependencies.reportError('tray-recovery-show-failed', showError)
      }
      return false
    }
  }

  private async requestQuitAndRecover(): Promise<void> {
    try {
      const result = await this.dependencies.requestQuit()
      if (!result.ok && !this.disposed) this.show()
    } catch (error) {
      this.dependencies.reportError('quit-request-failed', error)
      if (!this.disposed) this.show()
    }
  }
}
