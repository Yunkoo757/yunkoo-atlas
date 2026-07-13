import { app, BrowserWindow, shell, nativeTheme, Menu, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerLibraryIpc } from './library/ipc'
import { runElectronQaAndExit } from './qa'
import { registerAppUpdater, scheduleAutomaticUpdateChecks } from './updater'
import { loadWindowState, registerWindowIpc, trackWindowState } from './windowState'
import { initializeDiagnostics, logDiagnostic } from './diagnostics'

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
    title: 'Yunkoo Atlas',
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
    console.error(`[electron] did-fail-load ${code} ${desc} ${url}`)
    logDiagnostic('error', 'did-fail-load', { code, description: desc })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logDiagnostic('error', 'render-process-gone', details)
  })

  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(indexHtml).catch((err) => {
      console.error('[electron] loadFile failed', indexHtml, err)
      logDiagnostic('error', 'load-file-failed', err)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 等待渲染进程把编辑器草稿和最新快照写盘，再允许窗口关闭。
  let closeReady = false
  let closeWaiting = false
  mainWindow.on('close', (event) => {
    if (closeReady || !mainWindow) return
    event.preventDefault()
    if (closeWaiting) return
    closeWaiting = true
    const closingWindow = mainWindow
    let timer: ReturnType<typeof setTimeout> | null = null
    const finishClose = () => {
      if (timer) clearTimeout(timer)
      ipcMain.removeListener('app:before-close-complete', finishClose)
      closeReady = true
      if (!closingWindow.isDestroyed()) closingWindow.close()
    }
    ipcMain.once('app:before-close-complete', finishClose)
    timer = setTimeout(finishClose, 2500)
    closingWindow.webContents.send('app:before-close')
  })
}

app.whenReady().then(async () => {
  initializeDiagnostics()
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.yunkoo-atlas.app')
  }

  registerLibraryIpc()
  registerWindowIpc()

  if (process.env.LINEAR_JOURNAL_QA === '1') {
    await runElectronQaAndExit()
    return
  }

  registerAppUpdater()
  createWindow()
  scheduleAutomaticUpdateChecks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('child-process-gone', (_event, details) => {
  logDiagnostic('error', 'child-process-gone', details)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
