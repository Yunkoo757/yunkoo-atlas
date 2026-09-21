import assert from 'node:assert/strict'
import { applyNativeWindowBounds } from './nativeWindowBounds'

export function testNativeBoundsCorrectsPositionDependentDpiRounding(): void {
  for (const extra of [1, 2]) {
    let actual = { x: 275, y: 107, width: 1000, height: 800 }
    const target = { ...actual, width: 1440, height: 900 }
    applyNativeWindowBounds({
      getBounds: () => actual,
      setBounds: (next) => { actual = { ...next, width: next.width + extra, height: next.height + 2 } },
    }, target, 'win32')
    assert.deepEqual(actual, target)
  }
}

export function testNativeBoundsRespectsConstraintsAndOtherPlatforms(): void {
  for (const platform of ['win32', 'darwin']) {
    let calls = 0
    applyNativeWindowBounds({
      getBounds: () => ({ x: 0, y: 0, width: 960, height: 640 }),
      setBounds: () => { calls += 1 },
    }, { x: 0, y: 0, width: 800, height: 500 }, platform)
    assert.equal(calls, 1)
  }
}

export function testNativeBoundsStopsWhenNativeSizeCannotConverge(): void {
  let calls = 0
  applyNativeWindowBounds({
    getBounds: () => ({ x: 0, y: 0, width: 1441, height: 901 }),
    setBounds: () => { calls += 1 },
  }, { x: 0, y: 0, width: 1440, height: 900 }, 'win32')
  assert.equal(calls, 4)
}
