import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from '../desktop-visual-scenarios.mjs'
import {
  assertSafeElectronIsolationPaths,
  desktopVisualReportHasFailures,
  ensureRuntimeOutput,
  parseDesktopVisualCliArgs,
  removeTemporaryDirectoryBounded,
} from '../qa-desktop-visual.mjs'
import {
  assertCommitAddressableDesktopVisualPath,
} from '../desktop-visual-output-contract.mjs'
import * as desktopVisualSeed from './desktop-visual-seed.mjs'

const { createDesktopVisualSnapshot } = desktopVisualSeed
const FULL_COMMIT = 'a'.repeat(40)

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
      ['notes', '/notes'],
      ['missed', '/missed'],
      ['review-cases', '/review-cases'],
      ['paper-trades', '/sim'],
      ['live-archive', '/live-history'],
      ['live-history-cases', '/live-history?view=cases'],
      ['trash', '/trade-trash'],
      ['settings-profile', '/settings/profile'],
      ['settings-shortcuts', '/settings/shortcuts'],
      ['settings-strategies', '/settings/strategies'],
      ['settings-risk', '/settings/risk'],
      ['settings-risk-repair', '/settings/risk/data-repair'],
      ['settings-tags', '/settings/tags'],
      ['settings-symbols', '/settings/symbols'],
      ['settings-review-templates', '/settings/review-templates'],
      ['settings-display', '/settings/display'],
      ['settings-data', '/settings/data'],
      ['settings-updates', '/settings/updates'],
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
  const historicalSourceIds = new Set(snapshot.trades
    .filter((trade) => trade.tradeKind === 'live' && trade.closedTradingDayKey < '2026-07-01')
    .map((trade) => trade.id))
  assert.equal(snapshot.trades.some((trade) =>
    trade.tradeKind === 'case' && historicalSourceIds.has(trade.sourceTradeId)), true)
  const stageIds = new Set(snapshot.liveStages.map((stage) => stage.id))
  assert.deepEqual(
    snapshot.trades
      .filter((trade) => trade.tradeKind !== 'paper')
      .filter((trade) => trade.liveStageId !== null && !stageIds.has(trade.liveStageId))
      .map((trade) => trade.id),
    [],
  )
})

test('desktop visual archive readiness matches the unified trade workspace route', () => {
  const archive = DESKTOP_VISUAL_SCENARIOS.find((scenario) => scenario.id === 'live-archive')
  assert.equal(archive?.path, '/live-history')
  assert.equal(archive?.ready, '.list-scroll')
})

test('desktop visual CLI accepts one runtime and one protected output root', () => {
  assert.deepEqual(parseDesktopVisualCliArgs([]), { runtime: 'renderer', outputRoot: null })
  assert.deepEqual(parseDesktopVisualCliArgs(['--renderer']), { runtime: 'renderer', outputRoot: null })
  assert.deepEqual(
    parseDesktopVisualCliArgs(['--electron', '--output-root', 'evidence']),
    { runtime: 'electron', outputRoot: 'evidence' },
  )
  assert.throws(
    () => parseDesktopVisualCliArgs(['--renderer', '--electron']),
    /runtime may only be specified once/i,
  )
  assert.throws(
    () => parseDesktopVisualCliArgs(['--output-root', 'one', '--output-root', 'two']),
    /output-root may only be specified once/i,
  )
  assert.throws(() => parseDesktopVisualCliArgs(['--output-root']), /requires a path/i)
  assert.throws(() => parseDesktopVisualCliArgs(['--unknown']), /unknown desktop visual argument/i)
})

test('formal desktop visual evidence is bound to the current full commit and attempt', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-desktop-visual-contract-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const validRoot = join(
    root,
    'test-results',
    'desktop-visual-evidence',
    'baseline',
    FULL_COMMIT,
    'attempt-1',
  )

  assert.equal(assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: validRoot,
    expectedCommit: FULL_COMMIT,
  }), validRoot)
  assert.doesNotThrow(() => assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: join(validRoot, 'packaged', 'win32-x64-scale-100'),
    expectedCommit: FULL_COMMIT,
    allowDescendant: true,
  }))
  assert.throws(() => assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: join(root, 'test-results', 'desktop-visual-evidence', 'baseline', 'abc', 'attempt-1'),
    expectedCommit: FULL_COMMIT,
  }), /commit\/attempt layout|commit does not match/i)
  assert.throws(() => assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: validRoot,
    expectedCommit: 'b'.repeat(40),
  }), /does not match HEAD/i)
  assert.throws(() => assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: join(root, 'test-results', 'desktop-visual-evidence', 'baseline', FULL_COMMIT, 'attempt-0'),
    expectedCommit: FULL_COMMIT,
  }), /attempt-N/i)
  assert.throws(() => assertCommitAddressableDesktopVisualPath({
    root,
    outputPath: join(root, '..', 'outside'),
    expectedCommit: FULL_COMMIT,
  }), /unsafe desktop visual evidence path/i)
})

test('formal desktop visual runtimes coexist but never overwrite runtime or report evidence', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-desktop-visual-output-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const outputRoot = join(
    root,
    'test-results',
    'desktop-visual-evidence',
    'candidate',
    FULL_COMMIT,
    'attempt-1',
  )
  mkdirSync(outputRoot, { recursive: true })

  assert.doesNotThrow(() => ensureRuntimeOutput(outputRoot, 'renderer', { preserveExisting: true }))
  assert.throws(
    () => ensureRuntimeOutput(outputRoot, 'renderer', { preserveExisting: true }),
    /evidence already exists/i,
  )
  assert.doesNotThrow(() => ensureRuntimeOutput(outputRoot, 'electron', { preserveExisting: true }))
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

test('desktop visual report requires the exact unique 5 by 24 capture matrix', () => {
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

test('desktop visual cleanup retries transient Windows profile locks within a hard bound', async () => {
  let attempts = 0
  await removeTemporaryDirectoryBounded('isolated-profile', {
    timeoutMs: 50,
    retryDelayMs: 1,
    removeDirectory: async () => {
      attempts += 1
      if (attempts < 4) {
        const error = new Error('profile is still locked')
        error.code = 'EPERM'
        throw error
      }
    },
  })

  assert.equal(attempts, 4)
})

test('desktop visual cleanup reports a persistent profile lock after the bounded window', async () => {
  let attempts = 0
  await assert.rejects(
    () => removeTemporaryDirectoryBounded('isolated-profile', {
      timeoutMs: 10,
      retryDelayMs: 1,
      removeDirectory: async () => {
        attempts += 1
        const error = new Error('profile remains locked')
        error.code = 'EPERM'
        throw error
      },
    }),
    /profile remains locked/,
  )
  assert.ok(attempts > 1)
})

test('desktop visual seed envelope keeps schema v12 and native-stage ownership atomic', () => {
  assert.equal(
    typeof desktopVisualSeed.createDesktopVisualSeedEnvelope,
    'function',
    '视觉 QA 必须从同一 envelope 读取 schema 与快照，避免二者独立漂移',
  )

  const envelope = desktopVisualSeed.createDesktopVisualSeedEnvelope()
  const { snapshot } = envelope
  const stageIds = new Set(snapshot.liveStages.map((stage) => stage.id))

  assert.equal(envelope.schemaVersion, 12)
  assert.equal(snapshot.liveStages.filter((stage) => stage.status === 'current').length, 1)
  assert.equal(stageIds.has(snapshot.currentLiveStageId), true)
  assert.equal(Object.hasOwn(snapshot, 'livePerformanceCycles'), false)
  assert.equal(Object.hasOwn(snapshot, 'liveStatsStartTradingDayKey'), false)
  assert.deepEqual(
    snapshot.trades
      .filter((trade) => trade.tradeKind !== 'paper')
      .filter((trade) => typeof trade.liveStageId !== 'string' || !stageIds.has(trade.liveStageId))
      .map((trade) => trade.id),
    [],
  )
  assert.deepEqual(
    snapshot.weeklyReviews
      .filter((review) => !stageIds.has(review.liveStageId))
      .map((review) => review.id),
    [],
  )
})
