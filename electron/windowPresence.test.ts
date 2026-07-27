import {
  createElectronTrayFactory,
  WindowPresenceController,
  type ElectronTrayMenuItem,
  type PresenceWindow,
  type PresenceWindowCloseEvent,
} from './windowPresence'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

interface FixtureWindow extends PresenceWindow {
  emitClose(): { prevented: boolean }
}

interface PresenceFixture {
  calls: string[]
  controller: WindowPresenceController
  window: FixtureWindow
}

function createPresenceFixture(options: {
  visible?: boolean
  focused?: boolean
  minimized?: boolean
  missingWindow?: boolean
  trayFailure?: boolean
  quitResult?: { ok: true } | { ok: false; error?: string }
  exitAuthorized?: boolean
} = {}): PresenceFixture {
  const calls: string[] = []
  let visible = options.visible ?? true
  let focused = options.focused ?? true
  let minimized = options.minimized ?? false
  let currentWindow: FixtureWindow | null = null
  let closeListener: ((event: PresenceWindowCloseEvent) => void) | null = null
  const window: FixtureWindow = {
    isVisible: () => visible,
    isFocused: () => focused,
    isMinimized: () => minimized,
    isDestroyed: () => false,
    restore: () => {
      calls.push('window:restore')
      minimized = false
    },
    show: () => {
      calls.push('window:show')
      visible = true
    },
    focus: () => {
      calls.push('window:focus')
      focused = true
    },
    hide: () => {
      calls.push('window:hide')
      visible = false
      focused = false
    },
    on: (_event, listener) => {
      closeListener = listener
    },
    removeListener: (_event, listener) => {
      if (closeListener === listener) closeListener = null
    },
    emitClose: () => {
      let prevented = false
      closeListener?.({
        preventDefault: () => {
          prevented = true
          calls.push('close:prevent')
        },
      })
      return { prevented }
    },
  }
  if (!options.missingWindow) currentWindow = window
  const controller = new WindowPresenceController({
    ensureWindow: () => {
      if (!currentWindow) currentWindow = window
      return currentWindow
    },
    getWindow: () => currentWindow,
    createTray: (actions) => {
      calls.push('tray:create')
      if (options.trayFailure) throw new Error('tray unavailable')
      return {
        refreshMenu: () => {},
        dispose: () => {
          calls.push('tray:dispose')
        },
      }
    },
    requestQuit: async () => {
      calls.push('quit')
      return options.quitResult ?? { ok: true }
    },
    isExitAuthorized: () => options.exitAuthorized ?? false,
    showDock: () => { calls.push('dock:show') },
    hideDock: () => { calls.push('dock:hide') },
    reportError: (code) => { calls.push(`error:${code}`) },
  })
  return {
    calls,
    controller,
    window,
  }
}

export function testFocusedWindowTogglesToHiddenWithoutQuit(): void {
  const fixture = createPresenceFixture({ visible: true, focused: true })

  fixture.controller.initialize()
  fixture.controller.toggle()

  assert(fixture.calls.join('|') === 'tray:create|window:hide|dock:hide', '聚焦窗口应隐藏')
  assert(!fixture.calls.includes('quit'), '隐藏不得请求退出')
}

export function testBackgroundWindowIsShownAndFocusedInsteadOfHidden(): void {
  const fixture = createPresenceFixture({ visible: true, focused: false })
  fixture.controller.initialize()

  fixture.controller.toggle()

  assert(
    fixture.calls.join('|') === 'tray:create|dock:show|window:show|window:focus',
    '后台窗口应显示并聚焦，不得误隐藏',
  )
}

export function testMinimizedWindowIsRestoredBeforeShowingAndFocusing(): void {
  const fixture = createPresenceFixture({ visible: true, focused: false, minimized: true })
  fixture.controller.initialize()

  fixture.controller.toggle()

  assert(
    fixture.calls.join('|') === 'tray:create|window:restore|dock:show|window:show|window:focus',
    '最小化窗口应先恢复，再显示并聚焦',
  )
}

export function testHiddenWindowIsShownAndFocused(): void {
  const fixture = createPresenceFixture({ visible: false, focused: false })
  fixture.controller.initialize()

  fixture.controller.toggle()

  assert(
    fixture.calls.join('|') === 'tray:create|dock:show|window:show|window:focus',
    '隐藏窗口应显示并聚焦',
  )
}

export function testMissingWindowIsCreatedShownAndFocused(): void {
  const fixture = createPresenceFixture({ missingWindow: true, visible: false, focused: false })
  fixture.controller.initialize()

  fixture.controller.toggle()

  assert(
    fixture.calls.join('|') === 'tray:create|dock:show|window:show|window:focus',
    '缺失窗口应通过 ensureWindow 创建后显示并聚焦',
  )
}

export function testCloseWithTrayHidesInsteadOfQuitting(): void {
  const fixture = createPresenceFixture()
  fixture.controller.initialize()
  fixture.controller.attachWindow(fixture.window)

  const event = fixture.window.emitClose()

  assert(event.prevented, '未授权关闭且托盘可用时必须阻止窗口销毁')
  assert(
    fixture.calls.join('|') === 'tray:create|close:prevent|window:hide|dock:hide',
    '有托盘时关闭应隐藏到托盘',
  )
  assert(!fixture.calls.includes('quit'), '隐藏到托盘不得请求退出')
}

export async function testTrayFailureFallsBackToReliableClose(): Promise<void> {
  const fixture = createPresenceFixture({ trayFailure: true })
  fixture.controller.initialize()
  fixture.controller.attachWindow(fixture.window)

  const event = fixture.window.emitClose()
  await Promise.resolve()

  assert(event.prevented, '无托盘时也必须阻止窗口在可靠退出前销毁')
  assert(fixture.calls.includes('quit'), '没有托盘时关闭必须走可靠退出')
  assert(!fixture.calls.includes('window:hide'), '没有托盘时不得隐藏')
}

export function testAuthorizedCloseIsAllowedWithoutPresenceSideEffects(): void {
  const fixture = createPresenceFixture({ exitAuthorized: true })
  fixture.controller.initialize()
  fixture.controller.attachWindow(fixture.window)

  const event = fixture.window.emitClose()

  assert(!event.prevented, '已授权退出必须允许真实关闭')
  assert(!fixture.calls.includes('quit'), '已授权关闭不得开启第二轮退出')
  assert(!fixture.calls.includes('window:hide'), '已授权关闭不得隐藏窗口')
}

export async function testQuitFailureRestoresVisibleFocusedWindow(): Promise<void> {
  const fixture = createPresenceFixture({
    visible: false,
    focused: false,
    trayFailure: true,
    quitResult: { ok: false, error: 'backup failed' },
  })
  fixture.controller.initialize()
  fixture.controller.attachWindow(fixture.window)

  fixture.window.emitClose()
  await Promise.resolve()
  await Promise.resolve()

  assert(
    fixture.calls.join('|').endsWith('quit|dock:show|window:show|window:focus'),
    '可靠退出失败必须恢复可见且聚焦的窗口',
  )
}

export function testElectronTrayFactoryUsesInjectedMenuAndTrayBoundaries(): void {
  const calls: string[] = []
  const clickListener: { current: (() => void) | null } = { current: null }
  let menuItems: ElectronTrayMenuItem[] = []
  const createTray = createElectronTrayFactory({
    createTray: () => ({
      on: (_event, listener) => {
        clickListener.current = listener
      },
      setContextMenu: () => {
        calls.push('tray:menu')
      },
      destroy: () => {
        calls.push('tray:destroy')
      },
    }),
    buildMenu: (items) => {
      menuItems = [...items]
      return { items }
    },
  })
  const tray = createTray({
    toggle: () => { calls.push('action:toggle') },
    show: () => { calls.push('action:show') },
    hide: () => { calls.push('action:hide') },
    quit: () => { calls.push('action:quit') },
  })

  clickListener.current?.()
  tray.refreshMenu(true)
  const showItem = menuItems.find((item) => item.label === '显示 Trader Atlas')
  const hideItem = menuItems.find((item) => item.label === '隐藏 Trader Atlas')
  const quitItem = menuItems.find((item) => item.label === '彻底退出 Trader Atlas')
  assert(showItem?.enabled === false && hideItem?.enabled === true, '菜单状态必须反映当前窗口可见性')
  showItem?.click?.()
  hideItem?.click?.()
  quitItem?.click?.()
  tray.dispose()

  assert(
    calls.join('|') ===
      'action:toggle|tray:menu|action:show|action:hide|action:quit|tray:destroy',
    '托盘适配器必须通过注入边界连接点击、菜单与释放动作',
  )
}

export function testFailedInitialTrayMenuIsDisposedBeforeCleanRetry(): void {
  for (const failureAt of ['buildMenu', 'setContextMenu'] as const) {
    const calls: string[] = []
    const activeTrays = new Set<number>()
    let nextTrayId = 0
    let failFirstRefresh = true
    const window: PresenceWindow = {
      isVisible: () => true,
      isFocused: () => true,
      isMinimized: () => false,
      isDestroyed: () => false,
      restore: () => {},
      show: () => {},
      focus: () => {},
      hide: () => { calls.push('window:hide') },
      on: () => {},
      removeListener: () => {},
    }
    const createTray = createElectronTrayFactory({
      createTray: () => {
        const trayId = ++nextTrayId
        activeTrays.add(trayId)
        calls.push(`tray:create:${trayId}`)
        return {
          on: () => {},
          setContextMenu: () => {
            if (failureAt === 'setContextMenu' && failFirstRefresh) {
              failFirstRefresh = false
              throw new Error('menu set failed')
            }
          },
          destroy: () => {
            calls.push(`tray:destroy:${trayId}`)
            activeTrays.delete(trayId)
          },
        }
      },
      buildMenu: () => {
        if (failureAt === 'buildMenu' && failFirstRefresh) {
          failFirstRefresh = false
          throw new Error('menu build failed')
        }
        return {}
      },
    })
    const controller = new WindowPresenceController({
      ensureWindow: () => window,
      getWindow: () => window,
      createTray,
      requestQuit: async () => ({ ok: true }),
      isExitAuthorized: () => false,
      showDock: () => {},
      hideDock: () => {},
      reportError: (code) => { calls.push(`error:${code}`) },
    })

    assert(!controller.initialize(), `${failureAt} 失败必须让首次初始化失败`)
    assert(
      calls.join('|') === 'tray:create:1|tray:destroy:1|error:tray-create-failed',
      `${failureAt} 失败必须精确释放刚创建的托盘并报告一次`,
    )
    assert(activeTrays.size === 0, `${failureAt} 失败后不得遗留活动托盘`)

    controller.hide()
    assert(!calls.includes('window:hide'), `${failureAt} 失败后控制器不得再隐藏窗口`)
    assert(controller.initialize(), `${failureAt} 失败后必须能够干净重试`)
    assert(activeTrays.size === 1, `${failureAt} 重试后只能留下一个活动托盘`)
    assert(
      calls.filter((call) => call === 'tray:destroy:1').length === 1,
      `${failureAt} 失败的托盘必须只释放一次`,
    )

    controller.dispose()
  }
}

export function testDisposeRemovesCloseListenerAndDestroysTray(): void {
  const fixture = createPresenceFixture()
  fixture.controller.initialize()
  fixture.controller.attachWindow(fixture.window)

  fixture.controller.dispose()
  const callsAfterDispose = fixture.calls.join('|')
  fixture.window.emitClose()

  assert(callsAfterDispose === 'tray:create|tray:dispose', '释放必须销毁托盘')
  assert(fixture.calls.join('|') === callsAfterDispose, '释放后窗口关闭不得再触发控制器副作用')
}

export function testRuntimeTrayRefreshFailureRestoresWindowAndDisablesHiding(): void {
  const calls: string[] = []
  let refreshCount = 0
  let visible = true
  const window: PresenceWindow = {
    isVisible: () => visible, isFocused: () => true, isMinimized: () => false,
    isDestroyed: () => false, restore: () => {},
    show: () => { visible = true; calls.push('window:show') },
    focus: () => { calls.push('window:focus') },
    hide: () => { visible = false; calls.push('window:hide') },
    on: () => {}, removeListener: () => {},
  }
  const controller = new WindowPresenceController({
    ensureWindow: () => window, getWindow: () => window,
    createTray: () => ({
      refreshMenu: () => { refreshCount += 1; if (refreshCount === 2) throw new Error('refresh failed') },
      dispose: () => { calls.push('tray:dispose') },
    }),
    requestQuit: async () => ({ ok: true }), isExitAuthorized: () => false,
    showDock: () => { calls.push('dock:show') }, hideDock: () => { calls.push('dock:hide') },
    reportError: (code) => { calls.push(`error:${code}`) },
  })
  assert(controller.initialize(), '首次托盘初始化应成功')
  controller.hide()
  assert(!calls.includes('window:hide'), '菜单刷新失败时不得把窗口留在隐藏状态')
  assert(calls.includes('tray:dispose') && calls.includes('window:show'), '失败必须销毁托盘并恢复窗口')
  controller.hide()
  assert(!calls.includes('dock:hide'), '托盘失效后必须禁用隐藏')
}
