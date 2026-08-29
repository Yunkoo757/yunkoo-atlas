import assert from 'node:assert/strict'
import {
  normalizeWindowState,
  matchWindowSizePreset,
  fitWindowSizeToWorkArea,
  fitBoundsToWorkArea,
  resolveWindowMinimumBounds,
  DEFAULT_WINDOW_BOUNDS,
  MIN_WINDOW_BOUNDS,
} from './windowBounds'

export function testNormalizeWindowStateKeepsValidBounds(): void {
  const state = normalizeWindowState(
    { x: 120, y: 80, width: 1440, height: 900, isMaximized: true, resizable: false },
    [{ x: 0, y: 0, width: 1920, height: 1080 }],
  )
  assert.equal(state.width, 1440)
  assert.equal(state.height, 900)
  assert.equal(state.x, 120)
  assert.equal(state.y, 80)
  assert.equal(state.isMaximized, true)
  assert.equal(state.resizable, false)
}

export function testRestoredWindowFitsSmallerWorkAreaAndKeepsTitleBarVisible(): void {
  assert.deepEqual(
    fitBoundsToWorkArea(
      { x: 1600, y: 0, width: 1920, height: 1080 },
      [{ x: 0, y: 0, width: 1366, height: 768 }],
      { width: 960, height: 640 },
    ),
    { x: 0, y: 0, width: 1366, height: 768 },
  )
}

export function testRestoredWindowUsesAvailableAreaBelowDesktopMinimum(): void {
  assert.deepEqual(
    fitBoundsToWorkArea(
      { x: -2000, y: -1200, width: 700, height: 500 },
      [{ x: 20, y: 30, width: 800, height: 600 }],
      { width: 960, height: 640 },
    ),
    { x: 20, y: 30, width: 800, height: 600 },
  )
}

export function testWindowMinimumFollowsAWorkAreaBelowTheDesktopContract(): void {
  assert.deepEqual(
    resolveWindowMinimumBounds({ width: 820, height: 576 }),
    { width: 820, height: 576 },
  )
  assert.deepEqual(
    resolveWindowMinimumBounds({ width: 1280, height: 860 }),
    MIN_WINDOW_BOUNDS,
  )
}

export function testNormalizeWindowStateDropsOffscreenPosition(): void {
  const state = normalizeWindowState(
    { x: -4000, y: -3000, width: 1400, height: 800, isMaximized: false },
    [{ x: 0, y: 0, width: 1920, height: 1080 }],
  )
  assert.equal(state.width, 1400)
  assert.equal(state.height, 800)
  assert.equal(state.x, undefined)
  assert.equal(state.y, undefined)
}

export function testNormalizeWindowStateClampsToMinimum(): void {
  const state = normalizeWindowState(
    { width: 200, height: 100 },
    [{ x: 0, y: 0, width: 1920, height: 1080 }],
  )
  assert.equal(state.width, MIN_WINDOW_BOUNDS.width)
  assert.equal(state.height, MIN_WINDOW_BOUNDS.height)
}

export function testNormalizeWindowStateFallsBackToDefaults(): void {
  const state = normalizeWindowState(null, [])
  assert.deepEqual(
    { width: state.width, height: state.height, isMaximized: state.isMaximized },
    {
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: DEFAULT_WINDOW_BOUNDS.height,
      isMaximized: false,
    },
  )
  assert.equal(state.resizable, true, '旧窗口状态必须默认允许自由缩放')
}

export function testMatchWindowSizePresetRecognizesExactAndMaximized(): void {
  assert.equal(
    matchWindowSizePreset({ width: 1440, height: 900, isMaximized: false }),
    'comfort',
  )
  assert.equal(
    matchWindowSizePreset({ width: 1440, height: 900, isMaximized: true }),
    'maximized',
  )
  assert.equal(
    matchWindowSizePreset({ width: 1300, height: 800, isMaximized: false }),
    null,
  )
}

export function testFitWindowSizeToWorkAreaClampsAndKeepsVisible(): void {
  const fitted = fitWindowSizeToWorkArea(
    { width: 1920, height: 1080 },
    { x: 100, y: 80, width: 1280, height: 860 },
    { x: 0, y: 0, width: 1600, height: 900 },
  )
  assert.equal(fitted.width, 1600)
  assert.equal(fitted.height, 900)
  assert.equal(fitted.x, 0)
  assert.equal(fitted.y, 0)
}

export async function testDesktopWindowResizeLockUsesOnePersistedNativeContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [main, windowState, preload, bridge, settings] = await Promise.all([
    fs.readFile('electron/main.ts', 'utf8'),
    fs.readFile('electron/windowState.ts', 'utf8'),
    fs.readFile('electron/preload.ts', 'utf8'),
    fs.readFile('src/types/journalBridge.ts', 'utf8'),
    fs.readFile('src/views/settings/DisplaySettingsPanel.tsx', 'utf8'),
  ])
  assert(main.includes('resizable: windowState.resizable'), '启动窗口必须恢复本机缩放锁定状态')
  assert(windowState.includes("ipcMain.handle('window:setResizable'"), '主进程必须拥有缩放锁定 IPC')
  assert(windowState.includes('win.setResizable(resizable)'), '缩放锁定必须落到 Electron 原生窗口')
  assert(windowState.includes('if (restoreResizeLock) win.setResizable(false)'), '锁定时仍须允许程序应用尺寸预置并恢复锁定')
  assert(preload.includes("ipcRenderer.invoke('window:setResizable', resizable)"), 'preload 必须仅暴露受控缩放能力')
  assert(bridge.includes('setWindowResizable('), '渲染进程桥接类型必须声明缩放锁定能力')
  assert(settings.includes('label="锁定窗口大小"'), '显示设置必须提供明确的窗口大小锁定开关')
}
