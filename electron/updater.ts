import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import updaterPackage from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import {
  normalizeUpdateCredential,
  redactUpdateError,
  reduceUpdateState,
  type AppUpdateEvent,
  type AppUpdateState,
} from '../src/lib/appUpdate'

const { autoUpdater } = updaterPackage

const AUTO_CHECK_DELAY_MS = 10_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const CREDENTIAL_FILE = 'github-update-credential.json'

let state: AppUpdateState
let autoCheckTimer: ReturnType<typeof setInterval> | null = null
let registered = false

function initialState(): AppUpdateState {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    message: null,
  }
}

function credentialPath(): string {
  return path.join(app.getPath('userData'), CREDENTIAL_FILE)
}

function readStoredCredential(): string | null {
  const fromEnvironment = normalizeUpdateCredential(process.env.GH_TOKEN ?? '')
  if (fromEnvironment) return fromEnvironment
  if (!safeStorage.isEncryptionAvailable()) return null

  try {
    const payload = JSON.parse(fs.readFileSync(credentialPath(), 'utf8')) as {
      version?: number
      encrypted?: string
    }
    if (payload.version !== 1 || !payload.encrypted) return null
    return normalizeUpdateCredential(
      safeStorage.decryptString(Buffer.from(payload.encrypted, 'base64')),
    )
  } catch {
    return null
  }
}

function writeStoredCredential(value: string): void {
  const token = normalizeUpdateCredential(value)
  if (!token) throw new Error('令牌格式无效，请粘贴完整的 GitHub Fine-grained Token。')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全加密更新令牌。')
  }

  const encrypted = safeStorage.encryptString(token).toString('base64')
  fs.mkdirSync(path.dirname(credentialPath()), { recursive: true })
  fs.writeFileSync(
    credentialPath(),
    JSON.stringify({ version: 1, encrypted }),
    { encoding: 'utf8', mode: 0o600 },
  )
  process.env.GH_TOKEN = token
}

function clearStoredCredential(): void {
  delete process.env.GH_TOKEN
  try {
    fs.rmSync(credentialPath(), { force: true })
  } catch {
    // 文件不存在或被系统占用时，下次保存会覆盖。
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

function configurePrivateGitHubProvider(token: string): void {
  process.env.GH_TOKEN = token
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Yunkoo757',
    repo: 'yunkoo-atlas',
    private: true,
    token,
  })
}

async function checkForUpdates(): Promise<AppUpdateState> {
  const unsupported = supportMessage()
  if (unsupported) return transition({ type: 'unsupported', message: unsupported })

  const token = readStoredCredential()
  if (!token) {
    return transition({
      type: 'credential-required',
      message: '私有仓库需要只读 GitHub 更新令牌。',
    })
  }

  configurePrivateGitHubProvider(token)
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

export function registerAppUpdater(): void {
  if (registered) return
  registered = true
  state = initialState()
  registerUpdaterEvents()

  ipcMain.handle('update:getState', () => state)
  ipcMain.handle('update:hasCredential', () => Boolean(readStoredCredential()))
  ipcMain.handle('update:saveCredential', (_event, token: string) => {
    writeStoredCredential(token)
    return true
  })
  ipcMain.handle('update:clearCredential', () => {
    clearStoredCredential()
    transition({
      type: 'credential-required',
      message: '私有仓库需要只读 GitHub 更新令牌。',
    })
    return true
  })
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', async () => {
    if (state.phase !== 'available') return state
    await autoUpdater.downloadUpdate()
    return state
  })
  ipcMain.handle('update:install', () => {
    if (state.phase !== 'downloaded') return false
    const windows = BrowserWindow.getAllWindows()
    let timer: ReturnType<typeof setTimeout> | null = null
    const finishInstall = (
      _event: Electron.IpcMainEvent,
      result?: { ok?: boolean; error?: string },
    ) => {
      if (timer) clearTimeout(timer)
      ipcMain.removeListener('app:before-close-complete', finishInstall)
      if (result?.ok === false) {
        for (const window of windows) {
          if (!window.isDestroyed()) {
            window.webContents.send(
              'app:close-save-error',
              '保存失败，已取消安装更新。请检查磁盘空间后重试。',
            )
          }
        }
        return
      }
      autoUpdater.quitAndInstall(false, true)
    }
    ipcMain.once('app:before-close-complete', finishInstall)
    timer = setTimeout(() => {
      ipcMain.removeListener('app:before-close-complete', finishInstall)
      for (const window of windows) {
        if (!window.isDestroyed()) {
          window.webContents.send('app:close-save-error', '保存等待超时，已取消安装更新。')
        }
      }
    }, 15_000)
    for (const window of windows) {
      window.webContents.send('app:before-close')
    }
    return true
  })
}

export function scheduleAutomaticUpdateChecks(): void {
  if (supportMessage() || !readStoredCredential()) return
  setTimeout(() => void checkForUpdates(), AUTO_CHECK_DELAY_MS)
  if (autoCheckTimer) clearInterval(autoCheckTimer)
  autoCheckTimer = setInterval(() => void checkForUpdates(), AUTO_CHECK_INTERVAL_MS)
}
