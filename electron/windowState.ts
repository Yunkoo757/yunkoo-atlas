import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { safeConsoleError } from './diagnosticSanitizer'
import {
  normalizeWindowState,
  DEFAULT_WINDOW_BOUNDS,
  MIN_WINDOW_BOUNDS,
  fitBoundsToWorkArea,
  fitWindowSizeToWorkArea,
  resolveWindowMinimumBounds,
  matchWindowSizePreset,
  resolveWindowSizePreset,
  type PersistedWindowState,
} from '../src/lib/windowBounds'

export type { PersistedWindowState }
export {
  DEFAULT_WINDOW_BOUNDS,
  MIN_WINDOW_BOUNDS,
  WINDOW_SIZE_PRESETS,
  normalizeWindowState,
  matchWindowSizePreset,
  resolveWindowMinimumBounds,
} from '../src/lib/windowBounds'

const STATE_FILE = 'window-state.json'
const SAVE_DEBOUNCE_MS = 250

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}

export function loadWindowState(): PersistedWindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as unknown
    const displays = screen.getAllDisplays().map((display) => display.workArea)
    const normalized = normalizeWindowState(raw, displays)
    const fitted = fitBoundsToWorkArea(normalized, displays, MIN_WINDOW_BOUNDS)
    return {
      ...fitted,
      isMaximized: normalized.isMaximized,
      resizable: normalized.resizable,
    }
  } catch {
    return {
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: DEFAULT_WINDOW_BOUNDS.height,
      isMaximized: false,
      resizable: true,
    }
  }
}

function writeWindowState(state: PersistedWindowState): void {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

function captureWindowState(win: BrowserWindow): PersistedWindowState {
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
    resizable: win.isResizable(),
  }
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function describeWindow(win: BrowserWindow) {
  const state = captureWindowState(win)
  return {
    ...state,
    presetId: matchWindowSizePreset(state),
  }
}

/** 跟踪主窗口尺寸/位置变化并写入 userData */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const persist = () => {
    if (win.isDestroyed()) return
    try {
      writeWindowState(captureWindowState(win))
    } catch (error) {
      safeConsoleError('window-state-save-failed', error)
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })
}

export function registerWindowIpc(): void {
  ipcMain.handle('window:getState', (event) => {
    const win = senderWindow(event)
    if (!win || win.isDestroyed()) return null
    return describeWindow(win)
  })

  ipcMain.handle('window:applyPreset', (event, presetId: string) => {
    const win = senderWindow(event)
    if (!win || win.isDestroyed()) {
      return { ok: false as const, error: '窗口不可用' }
    }

    const preset = resolveWindowSizePreset(presetId)
    if (!preset) {
      return { ok: false as const, error: '未知的窗口尺寸预置' }
    }

    if (!preset.maximize && (preset.width == null || preset.height == null)) {
      return { ok: false as const, error: '预置缺少宽高' }
    }

    const restoreResizeLock = !win.isResizable()
    if (restoreResizeLock) win.setResizable(true)
    try {
      if (preset.maximize) {
        win.maximize()
      } else {
        const current = win.getBounds()
        const workArea = screen.getDisplayMatching(current).workArea
        const next = fitWindowSizeToWorkArea(
          { width: preset.width!, height: preset.height! },
          current,
          workArea,
        )
        if (win.isMaximized()) win.unmaximize()
        win.setBounds(next)
      }
    } finally {
      if (restoreResizeLock) win.setResizable(false)
    }
    writeWindowState(captureWindowState(win))
    return { ok: true as const, state: describeWindow(win) }
  })

  ipcMain.handle('window:setResizable', (event, resizable: boolean) => {
    const win = senderWindow(event)
    if (!win || win.isDestroyed()) {
      return { ok: false as const, error: '窗口不可用' }
    }
    if (typeof resizable !== 'boolean') {
      return { ok: false as const, error: '窗口缩放设置无效' }
    }
    win.setResizable(resizable)
    writeWindowState(captureWindowState(win))
    return { ok: true as const, state: describeWindow(win) }
  })
}
