import assert from 'node:assert/strict'
import {
  normalizeWindowState,
  matchWindowSizePreset,
  fitWindowSizeToWorkArea,
  fitBoundsToWorkArea,
  DEFAULT_WINDOW_BOUNDS,
  MIN_WINDOW_BOUNDS,
} from './windowBounds'

export function testNormalizeWindowStateKeepsValidBounds(): void {
  const state = normalizeWindowState(
    { x: 120, y: 80, width: 1440, height: 900, isMaximized: true },
    [{ x: 0, y: 0, width: 1920, height: 1080 }],
  )
  assert.equal(state.width, 1440)
  assert.equal(state.height, 900)
  assert.equal(state.x, 120)
  assert.equal(state.y, 80)
  assert.equal(state.isMaximized, true)
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
