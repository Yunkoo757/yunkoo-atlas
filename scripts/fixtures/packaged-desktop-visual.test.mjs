import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  assertSafePackagedEvidencePaths,
  buildRequiredPlatformChecks,
  resolvePackagedArtifactCandidates,
  resolvePackagedExecutableCandidates,
  validatePackagedVisualReport,
} from '../packaged-desktop-visual-contract.mjs'

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
  const complete = {
    schemaVersion: 1,
    runtime: 'packaged-electron',
    platform: 'darwin',
    source: { commit: 'a'.repeat(40), dirty: false },
    captures: Array.from({ length: 35 }, (_, index) => ({ id: `capture-${index}`, errors: [], horizontalOverflowPx: 0 })),
    checks: buildRequiredPlatformChecks('darwin').map((id) => ({ id, pass: true })),
  }

  assert.doesNotThrow(() => validatePackagedVisualReport(complete))
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, captures: complete.captures.slice(1) }),
    /exactly 35/,
  )
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, checks: complete.checks.filter((entry) => entry.id !== 'mac-quit-command') }),
    /mac-quit-command/,
  )
  assert.throws(
    () => validatePackagedVisualReport({ ...complete, source: { ...complete.source, dirty: true } }),
    /clean source commit/,
  )
})
