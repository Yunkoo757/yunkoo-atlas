import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from '../desktop-visual-scenarios.mjs'

import {
  assertSafePackagedEvidencePaths,
  assertSafePackagedVisualOutputPath,
  buildRequiredPlatformChecks,
  normalizePackagedScaleFactor,
  isWindowRestorationVisible,
  resolvePackagedArtifactCandidates,
  resolvePackagedExecutableCandidates,
  validatePackagedVisualReport,
} from '../packaged-desktop-visual-contract.mjs'
import * as packagedVisualContract from '../packaged-desktop-visual-contract.mjs'

const customInter = Object.freeze({
  familyName: 'Inter',
  postScriptName: 'Inter',
  isCustomFont: true,
  glyphCount: 8,
})
const windowsCjk = Object.freeze({
  familyName: 'Microsoft YaHei UI',
  postScriptName: 'MicrosoftYaHeiUI',
  isCustomFont: false,
  glyphCount: 8,
})

function createPackagedCaptures() {
  return DESKTOP_VISUAL_VIEWPORTS.flatMap((requestedViewport) =>
    DESKTOP_VISUAL_SCENARIOS.map((scenario) => ({
      id: `${requestedViewport.width}x${requestedViewport.height}/${scenario.id}`,
      requestedViewport,
      scenario: scenario.id,
      errors: [],
      horizontalOverflowPx: 0,
    })))
}

function createTypographyInput() {
  const fontFamily = '"Inter Variable", Inter, system-ui, "Microsoft YaHei", sans-serif'
  return {
    platform: 'win32',
    computed: {
      interLoaded: true,
      row: { fontSize: '13px', lineHeight: '20px', fontWeight: '400' },
      metadata: { fontSize: '12px', lineHeight: '16px', fontWeight: '500' },
      group: { fontSize: '13px', lineHeight: '20px', fontWeight: '600' },
      probes: {
        latin: { fontFamily },
        cjk: { fontFamily },
        mixed: { fontFamily },
        numeric: { fontFamily },
      },
      probeRendering: {
        latin: { rendered: true },
        cjk: { rendered: true },
        mixed: { rendered: true },
        numeric: { rendered: true },
      },
      monthGroupHeight: 36,
      monthTopGap: '8px',
      monthVirtualHeight: 44,
    },
    glyphFonts: {
      latin: [{ ...customInter, glyphCount: 23 }],
      cjk: [{ ...windowsCjk, glyphCount: 8 }],
      mixed: [{ ...customInter, glyphCount: 15 }, { ...windowsCjk, glyphCount: 3 }],
      numeric: [{ ...customInter, glyphCount: 20 }],
    },
  }
}

test('typography glyph matching binds Chromium internal names to declared native families', () => {
  assert.equal(typeof packagedVisualContract.isInterVariableGlyphFont, 'function')
  assert.equal(typeof packagedVisualContract.isPlatformCjkGlyphFont, 'function')
  assert.equal(packagedVisualContract.isInterVariableGlyphFont(
    { familyName: 'Inter', postScriptName: 'Inter', isCustomFont: true },
    '"Inter Variable", Inter, system-ui, sans-serif',
  ), true)
  assert.equal(packagedVisualContract.isInterVariableGlyphFont(
    { familyName: 'Inter', postScriptName: 'Inter', isCustomFont: false },
    '"Inter Variable", Inter, system-ui, sans-serif',
  ), false)
  assert.equal(packagedVisualContract.isPlatformCjkGlyphFont(
    { familyName: 'Microsoft YaHei UI' },
    'win32',
  ), true)
  assert.equal(packagedVisualContract.isPlatformCjkGlyphFont(
    { familyName: 'PingFang SC' },
    'darwin',
  ), true)
})

test('typography glyph checks reject unknown duplicate empty and incomplete probe fonts', () => {
  assert.equal(typeof packagedVisualContract.buildTypographyCheckResult, 'function')
  const clean = createTypographyInput()
  assert.equal(packagedVisualContract.buildTypographyCheckResult(clean).failureCount, 0)

  const invalidGlyphSets = [
    { latin: [customInter, { familyName: 'Arial', postScriptName: 'Arial', isCustomFont: false }] },
    { numeric: [] },
    { latin: [customInter, { ...customInter }] },
    { cjk: [windowsCjk, { familyName: 'SimSun', postScriptName: 'SimSun', isCustomFont: false }] },
    { cjk: [{ familyName: 'Songti SC', postScriptName: 'SongtiSC', isCustomFont: false }] },
    { mixed: [customInter] },
    { mixed: [windowsCjk] },
    { mixed: [customInter, { familyName: 'serif', postScriptName: 'serif', isCustomFont: false }] },
  ]
  for (const glyphFonts of invalidGlyphSets) {
    const result = packagedVisualContract.buildTypographyCheckResult({
      ...clean,
      glyphFonts: { ...clean.glyphFonts, ...glyphFonts },
    })
    assert.ok(result.failureCount > 0, `invalid glyph set must fail: ${JSON.stringify(glyphFonts)}`)
    assert.equal(
      result.checks
        .filter(({ id }) => id === 'typography-latin-inter' || id === 'typography-cjk-sans')
        .every(({ pass }) => pass === true),
      false,
    )
  }
})

test('typography role metrics fail closed on every required size line height and weight drift', () => {
  assert.equal(typeof packagedVisualContract.buildTypographyCheckResult, 'function')
  const clean = createTypographyInput()
  const drifts = [
    ['row', 'fontSize', '14px'],
    ['row', 'lineHeight', '21px'],
    ['row', 'fontWeight', '500'],
    ['metadata', 'fontSize', '13px'],
    ['metadata', 'lineHeight', '17px'],
    ['metadata', 'fontWeight', '400'],
    ['group', 'fontSize', '12px'],
    ['group', 'lineHeight', '19px'],
    ['group', 'fontWeight', '500'],
  ]

  for (const [role, property, value] of drifts) {
    const result = packagedVisualContract.buildTypographyCheckResult({
      ...clean,
      computed: {
        ...clean.computed,
        [role]: { ...clean.computed[role], [property]: value },
      },
    })
    assert.equal(
      result.checks.find(({ id }) => id === 'typography-role-metrics')?.pass,
      false,
      `${role}.${property} drift must fail`,
    )
    assert.equal(result.failureCount, 1, `${role}.${property} drift must increment failureCount`)
  }
})

test('packaged executable candidates cover native Windows and both macOS architectures', () => {
  const root = join('workspace', 'trader-atlas')
  const windows = resolvePackagedExecutableCandidates({ root, platform: 'win32', arch: 'x64' })
  const macArm = resolvePackagedExecutableCandidates({ root, platform: 'darwin', arch: 'arm64' })
  const macIntel = resolvePackagedExecutableCandidates({ root, platform: 'darwin', arch: 'x64' })

  assert.equal(windows.length, 1)
  assert.match(windows[0], /release[\\/]win-unpacked[\\/]Trader Atlas\.exe$/)
  assert.ok(macArm.some((candidate) => /release[\\/]mac-arm64[\\/]Trader Atlas\.app[\\/]Contents[\\/]MacOS[\\/]Trader Atlas$/.test(candidate)))
  assert.ok(macIntel.some((candidate) => /release[\\/]mac[\\/]Trader Atlas\.app[\\/]Contents[\\/]MacOS[\\/]Trader Atlas$/.test(candidate)))
})

test('packaged artifact candidates bind evidence to the package version and host architecture', () => {
  const root = join('workspace', 'trader-atlas')
  assert.match(
    resolvePackagedArtifactCandidates({ root, platform: 'darwin', arch: 'arm64', version: '1.3.3' })[0],
    /release[\\/]Trader-Atlas-1\.3\.3-mac-arm64\.zip$/,
  )
  assert.match(
    resolvePackagedArtifactCandidates({ root, platform: 'darwin', arch: 'x64', version: '1.3.3' })[0],
    /release[\\/]Trader-Atlas-1\.3\.3-mac-x64\.zip$/,
  )
  assert.match(
    resolvePackagedArtifactCandidates({ root, platform: 'win32', arch: 'x64', version: '1.3.3' })[0],
    /release[\\/]Trader-Atlas-1\.3\.3-win-x64\.exe$/,
  )
})

test('platform check plans demand direct native lifecycle evidence', () => {
  assert.deepEqual(buildRequiredPlatformChecks('win32'), [
    'native-platform',
    'native-scale',
    'native-file-picker',
    'save-error-recovery',
    'windows-close-explanation',
    'windows-close-to-tray',
    'window-restore-visible',
    'typography-inter-loaded',
    'typography-latin-inter',
    'typography-cjk-sans',
    'typography-role-metrics',
    'month-group-geometry',
  ])
  assert.deepEqual(buildRequiredPlatformChecks('darwin'), [
    'native-platform',
    'native-scale',
    'native-file-picker',
    'save-error-recovery',
    'mac-command-labels',
    'mac-close-keeps-app',
    'mac-no-windows-copy',
    'window-restore-visible',
    'mac-quit-command',
    'typography-inter-loaded',
    'typography-latin-inter',
    'typography-cjk-sans',
    'typography-role-metrics',
    'month-group-geometry',
  ])
})

test('macOS packaged evidence uses native display, shortcut settings, and menu quit probes', () => {
  const source = readFileSync('scripts/qa-packaged-desktop-visual.mjs', 'utf8')
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(packageJson.productName, 'Trader Atlas')
  assert.match(source, /Math\.abs\(dpr - runtime\.displayScaleFactor\)/)
  assert.match(source, /#\/settings\/shortcuts/)
  assert.match(source, /getDefaultRoleAccelerator/)
  assert.match(source, /app\.quit\(\)/)
  assert.match(source, /\.save-status\.is-dirty/)
  assert.match(source, /requestedViewport: viewport/)
  assert.match(source, /viewport: metrics\.actualViewport/)
  assert.match(source, /page\.locator\(selector\)\.first\(\)\.waitFor/)
  assert.match(source, /waitForProcessExit\(child, 20_000\)/)
  assert.doesNotMatch(source, /page\.keyboard\.press\('Meta\+q'\)/)
  assert.doesNotMatch(source, /quitMenuItem\.click/)
})

test('packaged visual waits for hydrated UI before routing the first scenario', () => {
  const source = readFileSync('scripts/qa-packaged-desktop-visual.mjs', 'utf8')
  const afterReload = source.slice(source.indexOf("await page.reload({ waitUntil: 'domcontentloaded'"))
  const hydration = afterReload.indexOf('await waitForUiHydration(page)')
  const scenarioLoop = afterReload.indexOf('for (const viewport of DESKTOP_VISUAL_VIEWPORTS)')

  assert.ok(hydration >= 0, 'packaged visual must wait for hydration after reloading the fixture')
  assert.ok(hydration < scenarioLoop, 'hydration must complete before routing the first visual scenario')
})

test('packaged typography diagnostics are captured in the same trade capture', () => {
  const source = readFileSync('scripts/qa-packaged-desktop-visual.mjs', 'utf8')
  const scenarioLoop = source.slice(source.indexOf('for (const viewport of DESKTOP_VISUAL_VIEWPORTS)'))
  const typographyProbe = scenarioLoop.indexOf('typography = await collectTypographyEvidence')
  const diagnosticSnapshot = scenarioLoop.indexOf('errors: [...diagnostics]')

  assert.ok(typographyProbe >= 0, 'packaged trade scenario must collect typography')
  assert.ok(typographyProbe < diagnosticSnapshot, 'probe errors must be snapshotted in the trade capture')
})

test('Windows window restoration allows only the native resize-frame overhang', () => {
  const workArea = { x: 0, y: 0, width: 820, height: 576 }
  assert.equal(
    isWindowRestorationVisible(
      { x: 0, y: 0, width: 820, height: 579 },
      workArea,
      'win32',
    ),
    true,
  )
  assert.equal(
    isWindowRestorationVisible(
      { x: 0, y: 0, width: 820, height: 589 },
      workArea,
      'win32',
    ),
    false,
  )
})

test('evidence isolation rejects application data and accepts unique temporary children', () => {
  const temporaryRoot = join('tmp', 'atlas-packaged-evidence-123')
  const userDataPath = join(temporaryRoot, 'user-data')
  const libraryPath = join(temporaryRoot, 'library')

  assert.doesNotThrow(() => assertSafePackagedEvidencePaths({
    temporaryRoot,
    userDataPath,
    libraryPath,
    applicationDataRoots: [join('Users', 'trader', 'AppData', 'Trader Atlas')],
  }))
  assert.throws(() => assertSafePackagedEvidencePaths({
    temporaryRoot,
    userDataPath: temporaryRoot,
    libraryPath,
    applicationDataRoots: [],
  }), /unique child/)
  assert.throws(() => assertSafePackagedEvidencePaths({
    temporaryRoot,
    userDataPath,
    libraryPath: join('Users', 'trader', 'AppData', 'Trader Atlas'),
    applicationDataRoots: [join('Users', 'trader', 'AppData', 'Trader Atlas')],
  }), /real application data/)
})

test('evidence isolation accepts canonical aliases of the same temporary root', (context) => {
  const physicalRoot = mkdtempSync(join(tmpdir(), 'atlas-packaged-evidence-physical-'))
  const aliasRoot = join(dirname(physicalRoot), `${physicalRoot.split(/[\\/]/).at(-1)}-alias`)
  mkdirSync(join(physicalRoot, 'user-data'), { recursive: true })
  mkdirSync(join(physicalRoot, 'library'), { recursive: true })
  symlinkSync(physicalRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
  context.after(() => {
    rmSync(aliasRoot, { force: true })
    rmSync(physicalRoot, { recursive: true, force: true })
  })

  assert.doesNotThrow(() => assertSafePackagedEvidencePaths({
    temporaryRoot: aliasRoot,
    userDataPath: join(physicalRoot, 'user-data'),
    libraryPath: join(aliasRoot, 'library'),
    applicationDataRoots: [],
  }))
})

test('report validation fails closed when screenshots or native platform checks are missing', () => {
  const captures = createPackagedCaptures()
  const complete = {
    schemaVersion: 1,
    runtime: 'packaged-electron',
    platform: 'darwin',
    source: { commit: 'a'.repeat(40), dirty: false },
    captures,
    checks: buildRequiredPlatformChecks('darwin').map((id) => ({ id, pass: true })),
    typography: { failureCount: 0 },
  }

  assert.doesNotThrow(() => validatePackagedVisualReport(complete))
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, captures: complete.captures.slice(1) }),
    /capture matrix/i,
  )
  assert.throws(
    () => validatePackagedVisualReport({
      ...complete,
      captures: [captures[0], ...captures.slice(0, -1)],
    }),
    /capture matrix/i,
  )
  assert.throws(
    () => validatePackagedVisualReport({
      ...complete,
      captures: captures.map((capture, index) => index === 0
        ? { ...capture, requestedViewport: { width: 1111, height: 777 } }
        : capture),
    }),
    /capture matrix/i,
  )
  assert.throws(
    () => validatePackagedVisualReport({
      ...complete,
      captures: captures.map((capture, index) => index === 0
        ? { ...capture, scenario: 'unknown-scenario' }
        : capture),
    }),
    /capture matrix/i,
  )
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, checks: complete.checks.filter((entry) => entry.id !== 'mac-quit-command') }),
    /mac-quit-command/,
  )
  assert.throws(
    () => validatePackagedVisualReport({
      ...complete,
      checks: complete.checks.filter((entry) => entry.id !== 'typography-cjk-sans'),
    }),
    /typography-cjk-sans/,
  )
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, source: { ...complete.source, dirty: true } }),
    /clean source commit/,
  )
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, typography: undefined }),
    /typography/i,
  )
  for (const pass of [false, 'false', 1]) {
    assert.throws(
      () => validatePackagedVisualReport({
        ...complete,
        checks: complete.checks.map((entry) => entry.id === 'typography-role-metrics'
          ? { ...entry, pass }
          : entry),
      }),
      /typography-role-metrics/,
      `required checks must reject pass=${JSON.stringify(pass)}`,
    )
  }

  const windows = {
    ...complete,
    platform: 'win32',
    scale: { requested: 1.25, devicePixelRatio: 1.25, displayScaleFactor: 1 },
    checks: buildRequiredPlatformChecks('win32').map((id) => ({ id, pass: true })),
  }
  assert.doesNotThrow(() => validatePackagedVisualReport(windows))
  assert.throws(
    () => validatePackagedVisualReport({
      ...windows,
      checks: windows.checks.filter((entry) => entry.id !== 'month-group-geometry'),
    }),
    /month-group-geometry/,
  )
  assert.throws(
    () => validatePackagedVisualReport({
      ...windows,
      scale: { ...windows.scale, devicePixelRatio: 1 },
    }),
    /verified scale factor/,
  )
})

test('packaged visual output is restricted to its evidence root', () => {
  const root = join('workspace', 'trader-atlas')
  const evidenceRoot = join(root, 'test-results', 'desktop-visual-packaged')

  assert.doesNotThrow(() => assertSafePackagedVisualOutputPath({
    root,
    outputPath: join(evidenceRoot, 'win32-x64-scale-125'),
  }))
  assert.throws(() => assertSafePackagedVisualOutputPath({ root, outputPath: root }), /output path/i)
  assert.throws(
    () => assertSafePackagedVisualOutputPath({ root, outputPath: join(root, 'release') }),
    /output path/i,
  )
})

test('Windows packaged evidence accepts only the supported 100 125 150 percent scale matrix', () => {
  assert.equal(normalizePackagedScaleFactor('1', 'win32'), 1)
  assert.equal(normalizePackagedScaleFactor('1.25', 'win32'), 1.25)
  assert.equal(normalizePackagedScaleFactor('1.5', 'win32'), 1.5)
  assert.throws(() => normalizePackagedScaleFactor('2', 'win32'), /scale factor/i)
  assert.equal(normalizePackagedScaleFactor(undefined, 'darwin'), null)

  const workflow = readFileSync('.github/workflows/desktop-visual-evidence.yml', 'utf8')
  assert.match(workflow, /name:\s*Windows packaged visual \(100\/125\/150%\)/)
  assert.match(workflow, /ATLAS_PACKAGED_SCALE_FACTOR:\s*'1\.25'/)
  assert.match(workflow, /ATLAS_PACKAGED_SCALE_FACTOR:\s*'1\.5'/)
})
