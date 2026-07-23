import { app, BrowserWindow, shell, nativeTheme, Menu, ipcMain } from 'electron'
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
  QuitCoordinator,
  RendererFlushTracker,
  type QuitIntent,
  type QuitOperationalFailure,
  type QuitOperationalLifecycle,
} from './quitCoordinator'
import { runElectronForcedKillMode } from './forcedKillQa'

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

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(app.getAppPath(), 'dist', 'icon.png'),
        path.join(process.resourcesPath, 'icon.png'),
      ]
    : [
        path.join(process.cwd(), 'build', 'icon.ico'),
        path.join(process.cwd(), 'build', 'icon.png'),
        path.join(process.cwd(), 'public', 'icon.png'),
      ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

let mainWindow: BrowserWindow | null = null
let gracefulExitAuthorized = false
const forcedKillMode = process.env.LINEAR_JOURNAL_FORCED_KILL_MODE
const hasSingleInstanceLock =
  process.env.LINEAR_JOURNAL_QA === '1' || forcedKillMode || app.requestSingleInstanceLock()

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
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
  quitOperationLogs.get(failure.operationId)?.failure(failure, {
    stage: failure.stage,
    code: failure.code,
  })
  quitOperationLogs.delete(failure.operationId)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:close-save-error', failure.message)
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
    return commitStorageExit(signal, deadlineAt, () => {
      const intent = resolveIntent()
      gracefulExitAuthorized = true
      try {
        if (intent === 'quit-and-install') performDownloadedUpdateInstall()
        else if (intent === 'quit') app.quit()
        else {
          for (const window of BrowserWindow.getAllWindows()) window.close()
        }
      } catch (error) {
        gracefulExitAuthorized = false
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

function createWindow() {
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
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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

  mainWindow.on('close', (event) => {
    if (gracefulExitAuthorized || !mainWindow) return
    event.preventDefault()
    void quitCoordinator.request('close')
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(async () => {
    initializeDiagnostics()
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.yunkoo-atlas.app')
    }

    if (forcedKillMode) {
      try {
        const libraryRoot = process.env.LINEAR_JOURNAL_LIBRARY
        if (!libraryRoot) throw new Error('LINEAR_JOURNAL_LIBRARY is required for forced-kill evidence')
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

    if (process.env.LINEAR_JOURNAL_QA === '1') {
      await runElectronQaAndExit()
      return
    }

    registerAppUpdater((intent) => quitCoordinator.request(intent))
    createWindow()
    scheduleAutomaticUpdateChecks()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
