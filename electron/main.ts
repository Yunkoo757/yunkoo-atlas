import { app, BrowserWindow, shell, nativeTheme, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerLibraryIpc } from './library/ipc'
import { runElectronQaAndExit } from './qa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 与 tokens.css --bg-app (lch 1.82% 272) 对齐，避免窗口加载前露出白边 */
const WINDOW_BG = '#050506'

nativeTheme.themeSource = 'dark'

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

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Trading Journal',
    backgroundColor: WINDOW_BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(`[electron] did-fail-load ${code} ${desc} ${url}`)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    const indexHtml = getIndexHtmlPath()
    void mainWindow.loadFile(indexHtml).catch((err) => {
      console.error('[electron] loadFile failed', indexHtml, err)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  registerLibraryIpc()

  if (process.env.LINEAR_JOURNAL_QA === '1') {
    await runElectronQaAndExit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
