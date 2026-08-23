import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  FINAL_PACKAGED_SMOKE_SCENARIOS,
  parseFinalPackagedArtifactArgs,
  validateFinalPackagedArtifactReport,
} from '../final-packaged-artifact-contract.mjs'
import {
  runWithCleanupPreservingErrors,
  waitForSpawnedChildExitBounded,
} from '../run-final-packaged-artifact-smoke.mjs'

// Quality-Scenario: R-FINAL-PAYLOAD
// 最终发布工件必须逐个经过安装/挂载后的七场景验证。

const commit = 'a'.repeat(40)
const hash = 'b'.repeat(64)

function validReport(platform = 'win32', artifactFormat = platform === 'win32' ? 'nsis' : 'zip') {
  const payload = (path) => ({ path, bytes: 42, sha256: hash })
  return {
    schemaVersion: 1,
    runtime: 'final-packaged-artifact',
    platform,
    architecture: platform === 'win32' ? 'x64' : 'arm64',
    artifactFormat,
    bundles: {
      renderer: { commit, dirty: false },
      main: { commit, dirty: false },
    },
    repository: { head: commit, dirty: false },
    ci: { githubSha: null },
    payload: {
      artifact: payload('artifact'),
      executable: payload('executable'),
      appAsar: payload('app.asar'),
    },
    scenarios: FINAL_PACKAGED_SMOKE_SCENARIOS.map((id) => ({ id, pass: true })),
    cleanup: {
      processIds: [10, 11, 12],
      allProcessesExited: true,
      temporaryRootDeleted: true,
      materializedPayloadRemoved: true,
      installerUninstalled: platform === 'win32',
      volumeDetached: platform === 'darwin' && artifactFormat === 'dmg',
    },
  }
}

test('final artifact CLI requires exact artifact architecture and output arguments', () => {
  assert.throws(() => parseFinalPackagedArtifactArgs([], 'win32'), /--artifact/)
  assert.throws(
    () => parseFinalPackagedArtifactArgs(['--artifact', 'release/app.exe', '--arch', 'arm64', '--output', 'out.json'], 'win32'),
    /architecture/i,
  )
  assert.throws(
    () => parseFinalPackagedArtifactArgs(['--artifact', 'release/app.zip', '--arch', 'x64', '--output', 'out.json'], 'win32'),
    /NSIS/i,
  )
  assert.doesNotThrow(() => parseFinalPackagedArtifactArgs(
    ['--artifact', 'release/app.dmg', '--arch', 'arm64', '--output', 'out.json'],
    'darwin',
  ))
  assert.doesNotThrow(() => parseFinalPackagedArtifactArgs(
    ['--', '--artifact', 'release/app.dmg', '--arch', 'arm64', '--output', 'out.json'],
    'darwin',
  ))
  assert.throws(
    () => parseFinalPackagedArtifactArgs([
      '--artifact', 'release/app.exe',
      '--arch', 'x64',
      '--output', 'out.json',
      '--scan-release', 'true',
    ], 'win32'),
    /unknown|exactly/i,
  )
  assert.throws(
    () => parseFinalPackagedArtifactArgs([
      '--artifact', 'release/app.exe',
      '--artifact', 'release/other.exe',
      '--arch', 'x64',
      '--output', 'out.json',
    ], 'win32'),
    /duplicate|exactly/i,
  )
})

test('final artifact report fails closed on every scenario payload identity and cleanup omission', () => {
  const complete = validReport()
  assert.doesNotThrow(() => validateFinalPackagedArtifactReport(complete))
  assert.throws(
    () => validateFinalPackagedArtifactReport({ ...complete, scenarios: complete.scenarios.slice(1) }),
    /scenarios/i,
  )
  assert.throws(
    () => validateFinalPackagedArtifactReport({
      ...complete,
      scenarios: [complete.scenarios[0], ...complete.scenarios.slice(0, -1)],
    }),
    /scenarios/i,
  )
  assert.throws(
    () => validateFinalPackagedArtifactReport({ ...complete, architecture: 'arm64' }),
    /architecture/i,
  )
  assert.throws(
    () => validateFinalPackagedArtifactReport({
      ...complete,
      bundles: { ...complete.bundles, main: { commit: 'c'.repeat(40), dirty: false } },
    }),
    /main bundle commit/i,
  )
  for (const key of ['artifact', 'executable', 'appAsar']) {
    assert.throws(
      () => validateFinalPackagedArtifactReport({
        ...complete,
        payload: { ...complete.payload, [key]: { ...complete.payload[key], bytes: 0 } },
      }),
      new RegExp(key, 'i'),
    )
  }
  for (const field of ['allProcessesExited', 'temporaryRootDeleted', 'materializedPayloadRemoved', 'installerUninstalled']) {
    assert.throws(
      () => validateFinalPackagedArtifactReport({
        ...complete,
        cleanup: { ...complete.cleanup, [field]: false },
      }),
      /cleanup/i,
      field,
    )
  }
})

test('final artifact runner materializes final formats and drives only installed or mounted payloads', () => {
  const source = readFileSync('scripts/run-final-packaged-artifact-smoke.mjs', 'utf8')
  assert.match(
    source,
    /spawnBounded\(artifactPath,\s*\['\/S', '\/currentuser', `\/D=\$\{installRoot\}`\]/,
    'NSIS smoke must force current-user mode so an existing per-machine install cannot trigger elevation or redirect the isolated /D target',
  )
  assert.match(
    source,
    /spawnBounded\(state\.uninstallerPath,\s*\['\/S', '\/currentuser'\]/,
    'NSIS cleanup must target only the temporary current-user install when a machine-wide install also exists',
  )
  assert.match(source, /hdiutil[\s\S]*attach[\s\S]*-mountpoint/)
  assert.match(source, /hdiutil[\s\S]*detach/)
  assert.match(source, /ditto[\s\S]*'-x'[\s\S]*'-k'/)
  for (const mode of ['seed', 'crash-save', 'verify']) assert.match(source, new RegExp(`'${mode}'`))
  for (const bridgeCall of [
    'commitStageRollover',
    'prepareLibrarySwitch',
    'activatePreparedLibrary',
    'saveAsset',
    'getAssetBytes',
  ]) assert.match(source, new RegExp(`journalBridge\\.${bridgeCall}`))
  assert.doesNotMatch(source, /win-unpacked|release\/mac-arm64|release\/mac\/Trader Atlas\.app/)
})

test('final artifact validates main and renderer provenance before the first migration write', () => {
  const source = readFileSync('scripts/run-final-packaged-artifact-smoke.mjs', 'utf8')
  const start = source.indexOf('const initialIdentity =')
  const migration = source.indexOf('scenarioEvidence.migration =', start)
  const execution = source.slice(start, migration)
  assert.match(execution, /validateBundleBuildIdentityEvidence\([\s\S]*\['main'\]\)/)
  assert.match(execution, /collectFinalPayloadIdentity/)
  assert.ok(
    source.indexOf('validateBundleBuildIdentityEvidence', start) < source.indexOf('collectFinalPayloadIdentity', start) &&
      source.indexOf('collectFinalPayloadIdentity', start) < migration,
    '二元 bundle provenance 必须在 v11 seed/migration 前完成',
  )
})

test('final artifact subprocess timeout remains bounded when hard kill is refused and no exit arrives', async () => {
  const child = new EventEmitter()
  child.pid = 4242
  child.kill = () => false
  const startedAt = Date.now()
  await assert.rejects(
    () => waitForSpawnedChildExitBounded(child, {
      timeoutMs: 10,
      killGraceMs: 10,
      label: 'stuck-final-payload-child',
    }),
    /hard kill|did not exit|timed out/i,
  )
  assert.ok(Date.now() - startedAt < 1_000, 'hard-kill-no-exit 不得让 final runner 永久 pending')
})

test('final artifact bridge cleanup preserves both scenario and cleanup failures', async () => {
  const scenarioError = new Error('scenario failed')
  const cleanupError = new Error('cleanup failed')
  let observed
  try {
    await runWithCleanupPreservingErrors(
      async () => { throw scenarioError },
      async () => { throw cleanupError },
      'bridge failed and cleanup failed',
    )
  } catch (error) {
    observed = error
  }
  assert.ok(observed instanceof AggregateError)
  assert.deepEqual(observed.errors, [scenarioError, cleanupError])
})

test('release workflow gates upload on every exact final artifact smoke', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.equal(
    pkg.scripts['qa:final-payload'],
    'node --experimental-strip-types scripts/run-final-packaged-artifact-smoke.mjs',
  )
  const windows = workflow.slice(workflow.indexOf('  build-windows:'), workflow.indexOf('  build-macos:'))
  const macos = workflow.slice(workflow.indexOf('  build-macos:'), workflow.indexOf('  publish:'))
  assert.match(windows, /pnpm qa:final-payload -- --artifact .*win-x64\.exe"? --arch x64 --output/)
  assert.ok(windows.indexOf('pnpm exec electron-builder --win nsis') < windows.indexOf('pnpm qa:final-payload'))
  assert.ok(windows.indexOf('pnpm qa:final-payload') < windows.indexOf('Upload Windows build artifacts'))
  assert.match(macos, /runner:\s*macos-26[\s\S]*arch:\s*arm64/)
  assert.match(macos, /runner:\s*macos-26-intel[\s\S]*arch:\s*x64/)
  assert.match(macos, /electron-builder --mac dmg zip --\$\{\{ matrix\.arch \}\}/)
  assert.match(macos, /pnpm qa:final-payload -- --artifact .*\.dmg"? --arch \$\{\{ matrix\.arch \}\} --output/)
  assert.match(macos, /pnpm qa:final-payload -- --artifact .*\.zip"? --arch \$\{\{ matrix\.arch \}\} --output/)
  assert.ok(macos.lastIndexOf('pnpm qa:final-payload') < macos.indexOf('Upload macOS build artifacts'))
})

test('release build artifacts remain flat and final smoke reports upload separately', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  for (const [platform, nextMarker] of [
    ['Windows', '  build-macos:'],
    ['macOS', '  publish:'],
  ]) {
    const start = workflow.indexOf(`      - name: Upload ${platform} build artifacts`)
    const jobEnd = workflow.indexOf(nextMarker, start)
    const section = workflow.slice(start, jobEnd < 0 ? undefined : jobEnd)
    const buildUpload = section.slice(0, section.indexOf('      - name:', 8))
    assert.doesNotMatch(buildUpload, /test-results\/final-packaged-artifact/)
    assert.match(section, new RegExp(`Upload ${platform} final payload report`))
    assert.match(section, /test-results\/final-packaged-artifact/)
  }
})
