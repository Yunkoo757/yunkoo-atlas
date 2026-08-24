import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import updaterPackage from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import {
  redactUpdateError,
  reduceUpdateState,
  type AppUpdateEvent,
  type AppUpdateState,
} from '../src/lib/appUpdate'

const { autoUpdater } = updaterPackage

const AUTO_CHECK_DELAY_MS = 10_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const LEGACY_CREDENTIAL_FILE = 'github-update-credential.json'

let state: AppUpdateState
let autoCheckTimer: ReturnType<typeof setInterval> | null = null
let autoCheckDelayTimer: ReturnType<typeof setTimeout> | null = null
let registered = false
let downloadInFlight = false

function initialState(): AppUpdateState {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    message: null,
  }
}

function removeLegacyStoredCredential(): void {
  try {
    fs.rmSync(path.join(app.getPath('userData'), LEGACY_CREDENTIAL_FILE), { force: true })
  } catch {
    // 旧文件不存在或暂时被占用，不影响公开 Release 更新。
  }
}

function broadcastState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update:state', state)
  }
}

function transition(event: AppUpdateEvent): AppUpdateState {
  state = reduceUpdateState(state, event)
  broadcastState()
  return state
}

function supportMessage(): string | null {
  if (!app.isPackaged) return '开发模式不会连接更新服务器，请在正式安装版中测试。'
  if (process.platform === 'darwin') return 'macOS 当前仅支持手动下载并安装新版本。'
  if (process.platform !== 'win32') return '当前系统暂不支持应用内更新。'
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return '便携版不支持应用内更新，请安装 NSIS 版本。'
  }
  return null
}

function configurePublicGitHubProvider(): void {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Yunkoo757',
    repo: 'yunkoo-atlas',
    private: false,
  })
}

async function checkForUpdates(): Promise<AppUpdateState> {
  const unsupported = supportMessage()
  if (unsupported) return transition({ type: 'unsupported', message: unsupported })

  configurePublicGitHubProvider()
  transition({ type: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    transition({
      type: 'error',
      message: redactUpdateError(error instanceof Error ? error.message : String(error)),
    })
  }
  return state
}

function registerUpdaterEvents(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => transition({ type: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    transition({ type: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => transition({ type: 'not-available' }))
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    transition({ type: 'progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    transition({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (error: Error) => {
    transition({ type: 'error', message: redactUpdateError(error.message) })
  })
}

export function performDownloadedUpdateInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}

export function registerAppUpdater(
  requestExit: (intent: 'quit-and-install') => Promise<{ ok: boolean }>,
): void {
  if (registered) return
  registered = true
  state = initialState()
  removeLegacyStoredCredential()
  registerUpdaterEvents()

  ipcMain.handle('update:getState', () => state)
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', async () => {
    if (state.phase === 'downloading' || downloadInFlight) return state
    if (state.phase !== 'available') return state
    downloadInFlight = true
    // 立刻进入 downloading，避免等首个 progress 事件前按钮像卡住且可重复点击。
    transition({ type: 'download-started' })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      transition({
        type: 'error',
        message: redactUpdateError(error instanceof Error ? error.message : String(error)),
      })
    } finally {
      downloadInFlight = false
    }
    return state
  })
  ipcMain.handle('update:install', async () => {
    if (state.phase !== 'downloaded') return false
    return (await requestExit('quit-and-install')).ok
  })
}

export function scheduleAutomaticUpdateChecks(): void {
  if (autoCheckDelayTimer) {
    clearTimeout(autoCheckDelayTimer)
    autoCheckDelayTimer = null
  }
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer)
    autoCheckTimer = null
  }
  if (supportMessage()) return
  autoCheckDelayTimer = setTimeout(() => {
    autoCheckDelayTimer = null
    void checkForUpdates()
  }, AUTO_CHECK_DELAY_MS)
  autoCheckTimer = setInterval(() => void checkForUpdates(), AUTO_CHECK_INTERVAL_MS)
}
