import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  cancelStorageExitPreparation,
  commitStorageExit,
  createVerifiedExitBackup,
  registerLibraryIpc,
} from './library/ipc'
import { runElectronQaAndExit } from './qa'
import {
  performDownloadedUpdateInstall,
  registerAppUpdater,
  scheduleAutomaticUpdateChecks,
} from './updater'
import { loadWindowState, registerWindowIpc, trackWindowState } from './windowState'
import { initializeDiagnostics, logDiagnostic } from './diagnostics'
import { safeConsoleError } from './diagnosticSanitizer'
import { beginOperation, type OperationLogHandle } from './operationLogger'
import {
  assertExitWithinDeadline,
  QuitCoordinator,
  RendererFlushTracker,
  type QuitIntent,
  type QuitOperationalFailure,
  type QuitOperationalLifecycle,
} from './quitCoordinator'
import { runElectronForcedKillMode } from './forcedKillQa'
import {
  DEFAULT_WINDOW_HOTKEY,
  normalizeWindowHotkeyBinding,
  type WindowHotkeyState,
  type WindowHotkeyUpdateResult,
} from '@/lib/windowHotkeyBinding'
import { FileWindowHotkeyStorage, WindowHotkeyService } from './windowHotkey'
import { createElectronTrayFactory, WindowPresenceController } from './windowPresence'
import { disposeOwnedLifecycle } from './lifecycleDisposal'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 与 tokens.css --bg-app (lch 1.82% 272) 对齐，避免窗口加载前露出白边 */
const WINDOW_BG = '#050506'

nativeTheme.themeSource = 'dark'

// Windows 高分屏：在 ready 前声明，避免系统对整窗做位图拉伸导致发糊
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('high-dpi-support', '1')
}

function getPreloadPath(): string {
  for (const name of ['preload.cjs', 'preload.js', 'preload.mjs']) {
    const candidate = path.join(__dirname, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(__dirname, 'preload.cjs')
}

function getIndexHtmlPath(): string {
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

function getDevelopmentIconCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      path.join(process.cwd(), 'build', 'icon.png'),
      path.join(process.cwd(), 'public', 'icon.png'),
    ]
  }
  return [
    path.join(process.cwd(), 'build', 'icon.ico'),
    path.join(process.cwd(), 'build', 'icon.png'),
    path.join(process.cwd(), 'public', 'icon.png'),
  ]
}

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(app.getAppPath(), 'dist', 'icon.png'),
        path.join(process.resourcesPath, 'icon.png'),
      ]
    : getDevelopmentIconCandidates()
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function getTrayImage(): Electron.NativeImage {
  const iconPath = process.platform === 'darwin'
    ? (app.isPackaged
        ? path.join(process.resourcesPath, 'trayTemplate.png')
        : path.join(process.cwd(), 'build', 'trayTemplate.png'))
    : getWindowIconPath()
  if (!iconPath) throw new Error('找不到托盘图标')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) throw new Error('托盘图标为空')
  const size = process.platform === 'darwin' ? 18 : 16
  const trayImage = image.resize({ width: size, height: size, quality: 'best' })
  if (trayImage.isEmpty()) throw new Error('托盘图标缩放失败')
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  return trayImage
}

let mainWindow: BrowserWindow | null = null
let windowPresence: WindowPresenceController | null = null
let windowHotkey: WindowHotkeyService | null = null
let lifecycleServicesDisposed = false
let gracefulExitAuthorized = false
const forcedKillMode = process.env.TRADER_ATLAS_FORCED_KILL_MODE
const hasSingleInstanceLock =
  process.env.TRADER_ATLAS_QA === '1' || forcedKillMode || app.requestSingleInstanceLock()

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) throw new Error('主窗口创建失败')
  return mainWindow
}

function unavailableWindowHotkeyState(): WindowHotkeyState {
  return {
    binding: { ...DEFAULT_WINDOW_HOTKEY },
    registered: false,
    errorCode: 'registration-unavailable',
  }
}

function unavailableWindowHotkeyResult(): WindowHotkeyUpdateResult {
  return {
    ok: false,
    errorCode: 'registration-unavailable',
    message: '快捷键服务尚未就绪',
    state: unavailableWindowHotkeyState(),
  }
}

async function disposeLifecycleServices(): Promise<void> {
  if (lifecycleServicesDisposed) return
  const hotkey = windowHotkey
  const presence = windowPresence
  await disposeOwnedLifecycle({
    disposePresence: () => presence?.dispose(),
    disposeHotkey: () => hotkey?.dispose() ?? Promise.resolve(),
    recoverPresence: () => {
      windowPresence = null
      initializeWindowPresence()
    },
  })
  windowHotkey = null
  windowPresence = null
  lifecycleServicesDisposed = true
}

function initializeWindowPresence(): void {
  windowPresence = new WindowPresenceController({
    ensureWindow: ensureMainWindow,
    getWindow: () => mainWindow,
    createTray: createElectronTrayFactory({
      createTray: () => {
        const tray = new Tray(getTrayImage())
        tray.setToolTip('Trader Atlas')
        return {
          on: (event, listener) => { if (process.platform === 'win32') tray.on(event, listener) },
          setContextMenu: (menu) => tray.setContextMenu(menu as Electron.Menu),
          destroy: () => tray.destroy(),
        }
      },
      buildMenu: (items) => Menu.buildFromTemplate([...items]),
    }),
    requestQuit: () => quitCoordinator.request('quit'),
    isExitAuthorized: () => gracefulExitAuthorized,
    showDock: () => { void app.dock?.show() },
    hideDock: () => { app.dock?.hide() },
    reportError: (code, error) => logDiagnostic('error', code, error),
  })
  windowPresence.initialize()
  if (mainWindow && !mainWindow.isDestroyed()) windowPresence.attachWindow(mainWindow)
}

async function initializeWindowHotkey(): Promise<void> {
  windowHotkey = new WindowHotkeyService({
    registrar: globalShortcut,
    storage: new FileWindowHotkeyStorage(path.join(app.getPath('userData'), 'window-hotkey.json')),
    onToggle: () => windowPresence?.toggle(),
  })
  try {
    await windowHotkey.initialize()
  } catch (error) {
    logDiagnostic('error', 'window-hotkey-initialize-failed', error)
    const failedWindowHotkey = windowHotkey
    windowHotkey = null
    try { await failedWindowHotkey.dispose() } catch (disposeError) {
      logDiagnostic('error', 'window-hotkey-dispose-failed', disposeError)
    }
  }
}

async function initializeLifecycleServices(): Promise<void> {
  lifecycleServicesDisposed = false
  initializeWindowPresence()
  await initializeWindowHotkey()
}

function waitForElectronTerminal(
  intent: QuitIntent,
  signal: AbortSignal,
  deadlineAt: number,
  trigger: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const windows = intent === 'close'
      ? BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
      : []
    let remainingWindows = windows.length
    const timeoutMs = Math.max(0, deadlineAt - Date.now())
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      app.removeListener('will-quit', onWillQuit)
      for (const window of windows) window.removeListener('closed', onClosed)
    }
    const succeed = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error('退出协调等待超时，已取消退出')) }
    const onAbort = () => fail()
    const onWillQuit = () => succeed()
    const onClosed = () => {
      remainingWindows -= 1
      if (remainingWindows === 0) succeed()
    }
    const timer = setTimeout(fail, timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    if (intent === 'close') {
      for (const window of windows) window.once('closed', onClosed)
    } else {
      app.once('will-quit', onWillQuit)
    }
    try {
      trigger()
      if (intent === 'close' && remainingWindows === 0) succeed()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    return ['https:', 'mailto:'].includes(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

function openExternalUrl(rawUrl: string): void {
  if (!isAllowedExternalUrl(rawUrl)) {
    logDiagnostic('warn', 'blocked-external-url')
    return
  }
  void shell.openExternal(rawUrl)
}

function requestRendererFlush(requestId: string, signal: AbortSignal): Promise<void> {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  if (windows.length === 0) return Promise.resolve()
  const tracker = new RendererFlushTracker(requestId, windows.map((window) => window.webContents.id))

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ipcMain.removeListener('app:before-close-complete', onComplete)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('退出协调等待超时，已取消退出'))
    }
    const onComplete = (
      event: Electron.IpcMainEvent,
      result?: { requestId?: string; webContentsId?: number; ok?: boolean; error?: string },
    ) => {
      if (!result || result.webContentsId !== event.sender.id) return
      const status = tracker.acknowledge(result.requestId ?? '', event.sender.id, result.ok !== false)
      if (status === 'ignored' || status === 'pending') return
      cleanup()
      if (status === 'failed') reject(new Error(result.error ?? 'renderer 保存失败'))
      else resolve()
    }
    ipcMain.on('app:before-close-complete', onComplete)
    signal.addEventListener('abort', onAbort, { once: true })
    for (const window of windows) {
      window.webContents.send('app:before-close', {
        requestId,
        webContentsId: window.webContents.id,
      })
    }
  })
}

const quitOperationLogs = new Map<string, OperationLogHandle>()

function reportExitStart(event: QuitOperationalLifecycle): void {
  quitOperationLogs.set(event.operationId, beginOperation('quit', {
    operationId: event.operationId,
    requestId: event.operationId,
    stage: event.stage,
    revisionBefore: 0,
  }))
}

function reportExitSuccess(event: QuitOperationalLifecycle): void {
  quitOperationLogs.get(event.operationId)?.success({ stage: event.stage, revisionAfter: 0 })
  quitOperationLogs.delete(event.operationId)
}

function reportExitError(failure: QuitOperationalFailure): void {
  try {
    windowPresence?.show()
  } catch (error) {
    logDiagnostic('error', 'exit-recovery-show-failed', error)
  }
  quitOperationLogs.get(failure.operationId)?.failure(failure, {
    stage: failure.stage,
    code: failure.code,
  })
  quitOperationLogs.delete(failure.operationId)
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send('app:close-save-error', failure.message)
    } catch (error) {
      logDiagnostic('error', 'exit-error-receipt-failed', error)
    }
  }
}

const quitCoordinator = new QuitCoordinator({
  timeoutMs: 15_000,
  createRequestId: randomUUID,
  requestRendererFlush,
  createVerifiedBackup: createVerifiedExitBackup,
  cancelPreparation: cancelStorageExitPreparation,
  reportStart: reportExitStart,
  reportSuccess: reportExitSuccess,
  reportError: reportExitError,
  commitExit(resolveIntent: () => QuitIntent, signal: AbortSignal, deadlineAt: number) {
    return commitStorageExit(signal, deadlineAt, async () => {
      const intent = resolveIntent()
      if (intent === 'close' && process.platform === 'darwin') {
        try {
          assertExitWithinDeadline(signal, deadlineAt)
          gracefulExitAuthorized = true
          await waitForElectronTerminal(intent, signal, deadlineAt, () => {
            for (const window of BrowserWindow.getAllWindows()) window.close()
          })
        } catch (error) {
          gracefulExitAuthorized = false
          throw error
        }
        return
      }
      try {
        await disposeLifecycleServices()
        assertExitWithinDeadline(signal, deadlineAt)
        gracefulExitAuthorized = true
        await waitForElectronTerminal(intent, signal, deadlineAt, () => {
          if (intent === 'quit-and-install') performDownloadedUpdateInstall()
          else if (intent === 'quit') app.quit()
          else for (const window of BrowserWindow.getAllWindows()) window.close()
        })
      } catch (error) {
        gracefulExitAuthorized = false
        if (lifecycleServicesDisposed) await initializeLifecycleServices()
        throw error
      }
    })
  },
})

function isTrustedAppNavigation(rawUrl: string, devUrl: string | undefined, indexHtml: string): boolean {
  try {
    const target = new URL(rawUrl)
    if (devUrl) return target.origin === new URL(devUrl).origin
    return target.protocol === 'file:' && path.normalize(fileURLToPath(target)) === path.normalize(indexHtml)
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const icon = getWindowIconPath()
  const windowState = loadWindowState()
  const devUrl = process.env.VITE_DEV_SERVER_URL
  const indexHtml = getIndexHtmlPath()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(typeof windowState.x === 'number' && typeof windowState.y === 'number'
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: 960,
    minHeight: 640,
    title: 'Trader Atlas',
    backgroundColor: WINDOW_BG,
    autoHideMenuBar: true,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (windowState.isMaximized) {
    mainWindow.maximize()
  }
  trackWindowState(mainWindow)
  windowPresence?.attachWindow(mainWindow)
  mainWindow.once('ready-to-show', () => {
    if (windowPresence) windowPresence.show()
    else mainWindow?.show()
  })

  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppNavigation(url, devUrl, indexHtml)) return
    event.preventDefault()
    openExternalUrl(url)
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    safeConsoleError('did-fail-load', { code, description: desc, url })
    logDiagnostic('error', 'did-fail-load', { code, description: desc })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logDiagnostic('error', 'render-process-gone', details)
  })

  if (process.platform === 'win32') {
    mainWindow.on('query-session-end', (event) => {
      if (gracefulExitAuthorized) return
      event.preventDefault()
      void quitCoordinator.request('quit')
    })
  }

  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(indexHtml).catch((err) => {
      safeConsoleError('load-file-failed', { path: indexHtml, error: err })
      logDiagnostic('error', 'load-file-failed', err)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    if (process.platform === 'darwin') gracefulExitAuthorized = false
  })

  return mainWindow
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowPresence?.show()
  })

  app.whenReady().then(async () => {
    initializeDiagnostics()
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.yunkoo-atlas.app')
    }

    if (forcedKillMode) {
      try {
        const libraryRoot = process.env.TRADER_ATLAS_LIBRARY
        if (!libraryRoot) throw new Error('TRADER_ATLAS_LIBRARY is required for forced-kill evidence')
        await runElectronForcedKillMode(forcedKillMode, libraryRoot)
        app.exit(0)
      } catch (error) {
        process.send?.({
          type: 'error',
          runtime: 'electron-main',
          electronVersion: process.versions.electron,
          processId: process.pid,
          message: error instanceof Error ? error.stack : String(error),
        })
        app.exit(1)
      }
      return
    }

    registerLibraryIpc()
    registerWindowIpc()
    ipcMain.handle('app:request-close', () => quitCoordinator.request('close'))
    ipcMain.handle('app:toggle-fullscreen', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return false
      const next = !mainWindow.isFullScreen()
      mainWindow.setFullScreen(next)
      return next
    })

    if (process.env.TRADER_ATLAS_QA === '1') {
      await runElectronQaAndExit()
      return
    }

    registerAppUpdater((intent) => quitCoordinator.request(intent))
    await initializeLifecycleServices()
    ipcMain.handle('window-hotkey:get', () => {
      return windowHotkey?.getState() ?? unavailableWindowHotkeyState()
    })
    ipcMain.handle('window-hotkey:set', (_event, input: unknown) => {
      const service = windowHotkey
      if (!service) return unavailableWindowHotkeyResult()
      const binding = normalizeWindowHotkeyBinding(input)
      if (!binding) {
        return {
          ok: false,
          errorCode: 'invalid-binding',
          message: '不支持这个系统级快捷键',
          state: service.getState(),
        } satisfies WindowHotkeyUpdateResult
      }
      return service.update(binding)
    })
    ipcMain.handle('window-hotkey:reset', () => {
      return windowHotkey?.reset() ?? unavailableWindowHotkeyResult()
    })
    createWindow()
    scheduleAutomaticUpdateChecks()

    app.on('activate', () => {
      windowPresence?.show()
    })
  })
}

app.on('child-process-gone', (_event, details) => {
  logDiagnostic('error', 'child-process-gone', details)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (gracefulExitAuthorized) app.quit()
    else void quitCoordinator.request('quit')
  }
})

app.on('before-quit', (event) => {
  if (gracefulExitAuthorized || !hasSingleInstanceLock) return
  event.preventDefault()
  void quitCoordinator.request('quit')
})

app.on('will-quit', () => {
  if (lifecycleServicesDisposed) return
  lifecycleServicesDisposed = true
  windowPresence?.dispose()
  windowPresence = null
  // 异步释放在 QuitCoordinator 提交退出前等待；异常路径仅做同步兜底。
  globalShortcut.unregisterAll()
  windowHotkey = null
})
