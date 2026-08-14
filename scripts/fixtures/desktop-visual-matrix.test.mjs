import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from '../desktop-visual-scenarios.mjs'
import {
  assertSafeElectronIsolationPaths,
  desktopVisualReportHasFailures,
} from '../qa-desktop-visual.mjs'
import { createDesktopVisualSnapshot } from './desktop-visual-seed.mjs'

function createDesktopCaptures() {
  return DESKTOP_VISUAL_VIEWPORTS.flatMap((viewport) =>
    DESKTOP_VISUAL_SCENARIOS.map((scenario) => ({ viewport, scenario })))
}

test('desktop visual matrix owns every supported window and core route', () => {
  assert.deepEqual(DESKTOP_VISUAL_VIEWPORTS, [
    { width: 960, height: 640 },
    { width: 1280, height: 860 },
    { width: 1440, height: 900 },
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
  ])
  assert.deepEqual(
    DESKTOP_VISUAL_SCENARIOS.map(({ id, path }) => [id, path]),
    [
      ['today', '/today-record'],
      ['trades', '/list'],
      ['detail', '/trade/TRD-131'],
      ['dashboard', '/dashboard'],
      ['weekly', '/weekly-review'],
      ['review-session', '/review-session'],
      ['settings-data', '/settings/data'],
    ],
  )
})

test('desktop visual matrix contains no mobile product viewport', () => {
  assert.equal(DESKTOP_VISUAL_VIEWPORTS.some(({ width }) => width < 960), false)
})

test('desktop visual fixture covers populated desktop workflows without user data', () => {
  const snapshot = createDesktopVisualSnapshot()

  assert.equal(snapshot.trades.some((trade) => trade.ref === 'TRD-131'), true)
  assert.deepEqual(
    [...new Set(snapshot.trades.map((trade) => trade.status))].sort(),
    ['breakeven', 'loss', 'missed', 'open', 'planned', 'win'],
  )
  assert.equal(snapshot.weeklyReviews.some((review) => review.weekStart === '2026-08-10'), true)
  assert.equal(snapshot.profile.displayName, '桌面视觉样本')
  assert.equal(snapshot.display.tradingDayStartHour, 0)
})

test('desktop visual Electron mode rejects real application data paths', () => {
  const tempRoot = 'C:\\Temp\\desktop-visual-run'
  const realApplicationData = 'C:\\Users\\Trader\\AppData\\Roaming\\Trader Atlas'

  assert.doesNotThrow(() => assertSafeElectronIsolationPaths({
    userDataPath: `${tempRoot}\\user-data`,
    libraryPath: `${tempRoot}\\library`,
    temporaryRoot: tempRoot,
    realApplicationDataRoots: [realApplicationData],
  }))
  assert.throws(() => assertSafeElectronIsolationPaths({
    userDataPath: `${realApplicationData}\\qa-user-data`,
    libraryPath: `${realApplicationData}\\qa-library`,
    temporaryRoot: realApplicationData,
    realApplicationDataRoots: [realApplicationData],
  }), /real application data/i)
})

test('desktop visual report fails closed on runtime errors or horizontal overflow', () => {
  const captures = createDesktopCaptures()
  const clean = {
    consoleErrors: [],
    pageErrors: [],
    metrics: { overflowCaptureCount: 0 },
    typography: { failureCount: 0 },
    captures,
  }

  assert.equal(desktopVisualReportHasFailures(clean), false)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    typography: { failureCount: 1 },
  }), true)
  assert.equal(desktopVisualReportHasFailures({
    consoleErrors: [],
    pageErrors: [],
    metrics: { overflowCaptureCount: 0 },
    captures,
  }), true)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    metrics: { overflowCaptureCount: 1 },
  }), true)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    pageErrors: ['render failed'],
  }), true)
})

test('desktop visual report requires the exact unique 5 by 7 capture matrix', () => {
  const captures = createDesktopCaptures()
  const clean = {
    consoleErrors: [],
    pageErrors: [],
    metrics: { overflowCaptureCount: 0 },
    typography: { failureCount: 0 },
    captures,
  }

  assert.equal(desktopVisualReportHasFailures({ ...clean, captures: captures.slice(1) }), true)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    captures: [captures[0], ...captures.slice(0, -1)],
  }), true)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    captures: captures.map((capture, index) => index === 0
      ? { ...capture, viewport: { width: 1111, height: 777 } }
      : capture),
  }), true)
  assert.equal(desktopVisualReportHasFailures({
    ...clean,
    captures: captures.map((capture, index) => index === 0
      ? { ...capture, scenario: { ...capture.scenario, id: 'unknown-scenario' } }
      : capture),
  }), true)
})

test('desktop typography diagnostics are snapshotted after the probe collection', () => {
  const source = readFileSync('scripts/qa-desktop-visual.mjs', 'utf8')
  const captureScenario = source.slice(
    source.indexOf('async function captureScenario'),
    source.indexOf('function bindDiagnostics'),
  )
  const typographyProbe = captureScenario.indexOf('await afterSettlement?.()')
  const consoleSnapshot = captureScenario.indexOf('consoleErrors: [...diagnostics.console]')
  const pageSnapshot = captureScenario.indexOf('pageErrors: [...diagnostics.page]')

  assert.ok(typographyProbe >= 0, 'captureScenario must collect typography before diagnostics are frozen')
  assert.ok(typographyProbe < consoleSnapshot, 'probe console errors must belong to the current capture')
  assert.ok(typographyProbe < pageSnapshot, 'probe page errors must belong to the current capture')
})
