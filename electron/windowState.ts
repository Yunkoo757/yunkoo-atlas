import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  normalizeWindowState,
  DEFAULT_WINDOW_BOUNDS,
  fitWindowSizeToWorkArea,
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
    return normalizeWindowState(raw, displays)
  } catch {
    return {
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: DEFAULT_WINDOW_BOUNDS.height,
      isMaximized: false,
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
      console.error('[electron] failed to save window state', error)
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

    if (preset.maximize) {
      win.maximize()
      writeWindowState(captureWindowState(win))
      return { ok: true as const, state: describeWindow(win) }
    }

    if (preset.width == null || preset.height == null) {
      return { ok: false as const, error: '预置缺少宽高' }
    }

    if (win.isMaximized()) win.unmaximize()
    const current = win.getBounds()
    const workArea = screen.getDisplayMatching(current).workArea
    const next = fitWindowSizeToWorkArea(
      { width: preset.width, height: preset.height },
      current,
      workArea,
    )
    win.setBounds(next)
    writeWindowState(captureWindowState(win))
    return { ok: true as const, state: describeWindow(win) }
  })
}
