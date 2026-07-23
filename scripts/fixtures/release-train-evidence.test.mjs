import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

import {
  assetLifecyclePassed,
  EXPECTED_FINAL_CHECK_NAMES,
  finalQualityManifestPassed,
  forcedKillPassed,
  fullQaPassed,
  persistenceReleaseGatePassed,
  releaseTrainDrillsPassed,
} from '../release-evidence-validation.mjs'
import { PERSISTENCE_BASELINE_METRICS } from '../persistence-baseline.mjs'

test('发布证据聚合器对四个 Train 执行同源码身份、干净工作树与双平台门', () => {
  const source = fs.readFileSync('scripts/verify-release-train-evidence.mjs', 'utf8')
  const validation = fs.readFileSync('scripts/release-evidence-validation.mjs', 'utf8')
  const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8')
  for (const train of ['release-0', 'release-1', 'release-2', 'release-3']) {
    assert.match(source, new RegExp(`id: '${train}'`))
  }
  assert.match(source, /git tree mismatch/)
  assert.match(source, /source identity mismatch/)
  assert.match(source, /release evidence was produced from a dirty working tree/)
  assert.match(source, /current release working tree is dirty/)
  assert.match(source, /ambiguous reports:/)
  assert.match(source, /invalid JSON:/)
  assert.match(source, /name === 'release-train-drills\.json'/)
  assert.match(validation, /\['stop', 'rollback', 'userRecovery'\]/)
  assert.match(source, /forcedKillPassed\(value, 'win32', 'NTFS'\)/)
  assert.match(source, /forcedKillPassed\(value, 'darwin', 'APFS'\)/)
  assert.match(source, /assetLifecyclePassed\(value, 'win32', 'NTFS'\)/)
  assert.match(source, /assetLifecyclePassed\(value, 'darwin', 'APFS'\)/)
  assert.match(source, /forced-kill-windows/)
  assert.match(source, /forced-kill-macos/)
  assert.match(source, /asset-lifecycle-windows/)
  assert.match(source, /asset-lifecycle-macos/)
  assert.match(source, /requireComplete && report\.status !== 'pass'/)
  assert.match(source, /final-quality-manifest\.json/)
  assert.match(source, /normal:/)
  assert.match(source, /performance:/)
  assert.match(source, /dualPlatform:/)
  assert.match(source, /releaseCandidate:/)
  assert.match(source, /releaseCandidate: requireComplete &&/)
  assert.match(workflow, /path: test-results\/collected-evidence/)
  assert.match(workflow, /--evidence-root test-results\/collected-evidence --require-complete/)
  assert.match(workflow, /test-results\/release-trains\/final-quality-manifest\.json/)
  assert.match(workflow, /name: train-recovery-evidence/)
  assert.match(workflow, /path: test-results\/final-quality-evidence/)
  assert.match(workflow, /verify-final-quality-manifest\.mjs test-results\/final-quality-evidence\/final-quality-manifest\.json/)
  assert.ok(
    workflow.indexOf('Verify final quality manifest authorizes this checkout') <
      workflow.indexOf('Download verified build artifacts'),
    'publish 必须在下载未忽略的构建工件前验证 clean provenance',
  )
  assert.doesNotThrow(() => execFileSync('git', [
    'check-ignore',
    '-q',
    'test-results/collected-evidence/probe.json',
  ]))
  assert.doesNotThrow(() => execFileSync('git', [
    'check-ignore',
    '-q',
    'test-results/final-quality-evidence/final-quality-manifest.json',
  ]))
})

test('QA 与性能最小伪造报告不能通过最终 manifest', () => {
  assert.equal(fullQaPassed({ status: 'pass', mode: 'full' }), false)
  assert.equal(fullQaPassed({
    version: 1,
    status: 'pass',
    mode: 'full',
    commands: ['qa:ci', 'qa:sidebar', 'qa', 'qa:linear', 'build:app', 'qa:dashboard-10k', 'qa:electron'],
  }), true)

  const metrics = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 1]))
  const valid = {
    version: 1,
    status: 'pass',
    gitCommit: 'a'.repeat(40),
    gitTree: 'b'.repeat(40),
    workingTreeDirty: false,
    sourceFingerprint: 'c'.repeat(64),
    sourceIdentity: `git-tree:${'b'.repeat(40)}`,
    approvedBaseline: {
      version: 1,
      approvedBy: 'Yunkoo老师',
      approvedAt: '2026-07-23T00:00:00.000Z',
      metrics,
    },
    attempts: [{
      number: 1,
      gitCommit: 'a'.repeat(40),
      gitTree: 'b'.repeat(40),
      workingTreeDirty: false,
      sourceFingerprint: 'c'.repeat(64),
      sourceIdentity: `git-tree:${'b'.repeat(40)}`,
      metrics,
    }],
    regressions: [],
  }
  assert.equal(persistenceReleaseGatePassed(valid), true)
  assert.equal(persistenceReleaseGatePassed({ ...valid, attempts: [] }), false)
  assert.equal(persistenceReleaseGatePassed({ ...valid, approvedBaseline: {} }), false)
  assert.equal(persistenceReleaseGatePassed({
    ...valid,
    attempts: [{ ...valid.attempts[0], metrics: Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 999999])) }],
  }), false)
  assert.equal(persistenceReleaseGatePassed({
    ...valid,
    attempts: [{ ...valid.attempts[0], workingTreeDirty: true }],
  }), false)
  const regressedMetrics = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 2]))
  assert.equal(persistenceReleaseGatePassed({
    ...valid,
    attempts: [
      { ...valid.attempts[0], metrics: regressedMetrics },
      { ...valid.attempts[0], number: 2 },
    ],
  }), true)
  assert.equal(persistenceReleaseGatePassed({
    ...valid,
    attempts: [valid.attempts[0], { ...valid.attempts[0], number: 2 }],
  }), false)
})

test('最终质量清单必须由 publish 针对当前干净源码再次授权', () => {
  const provenance = {
    gitCommit: 'a'.repeat(40),
    gitTree: 'b'.repeat(40),
    workingTreeDirty: false,
    sourceFingerprint: 'c'.repeat(64),
    sourceIdentity: `git-tree:${'b'.repeat(40)}`,
  }
  const checks = EXPECTED_FINAL_CHECK_NAMES.map((name) => ({ name, pass: true }))
  const manifest = {
    version: 1,
    status: 'pass',
    releaseCandidate: true,
    ...provenance,
    gates: {
      normal: { status: 'pass' },
      performance: { status: 'pass' },
      dualPlatform: { status: 'pass' },
    },
    checks,
    trains: ['release-0', 'release-1', 'release-2', 'release-3'].map((id) => ({ id, status: 'pass' })),
  }
  assert.equal(finalQualityManifestPassed(manifest, provenance), true)
  assert.equal(finalQualityManifestPassed({ ...manifest, releaseCandidate: false }, provenance), false)
  assert.equal(finalQualityManifestPassed({ ...manifest, gitTree: 'd'.repeat(40) }, provenance), false)
  assert.equal(finalQualityManifestPassed({ ...manifest, checks: checks.map((check, index) => index === 3 ? { ...check, pass: false } : check) }, provenance), false)
  assert.equal(finalQualityManifestPassed({
    ...manifest,
    checks: checks.map((check, index) => index === 3 ? { ...check, name: checks[0].name } : check),
  }, provenance), false)
  assert.equal(finalQualityManifestPassed(manifest, { ...provenance, workingTreeDirty: true }), false)
})

test('损坏、重复或不完整的演练与平台报告必须 fail-closed', () => {
  const phase = { status: 'pass' }
  const validTrain = (id) => ({
    id,
    status: 'pass',
    phases: { stop: phase, rollback: phase, userRecovery: phase },
  })
  const validDrills = {
    status: 'pass',
    trains: ['release-0', 'release-1', 'release-2', 'release-3'].map(validTrain),
  }
  assert.equal(releaseTrainDrillsPassed(validDrills), true)
  assert.equal(releaseTrainDrillsPassed({
    ...validDrills,
    trains: ['release-0', 'release-0', 'release-2', 'release-3'].map(validTrain),
  }), false)
  assert.equal(releaseTrainDrillsPassed({
    ...validDrills,
    trains: validDrills.trains.map((train, index) => index === 3
      ? { ...train, phases: { ...train.phases, userRecovery: { status: 'hold' } } }
      : train),
  }), false)

  const forced = {
    status: 'pass', scenarioId: 'E-FORCED-KILL', platform: 'win32', fileSystem: 'NTFS',
    process: {
      runtime: 'electron-main',
      electronVersion: '43.1.0',
      childPid: 1234,
      mainProcessPid: 1234,
      saveStartingObserved: true,
      atomicTempFileObserved: '.journal.db.test.tmp',
      killRequestedAt: '2026-07-23T00:00:00.000Z',
      killSignalSent: true,
      signal: 'SIGKILL',
      exitCode: null,
      saveCompletedAcknowledged: false,
    },
    recovery: {
      lastConfirmedRecovered: true,
      unconfirmedMemoryEditPromised: false,
      unconfirmedPendingRevisionAbsent: true,
    },
  }
  assert.equal(forcedKillPassed(forced, 'win32', 'NTFS'), true)
  assert.equal(forcedKillPassed({ ...forced, fileSystem: 'exFAT' }, 'win32', 'NTFS'), false)
  assert.equal(forcedKillPassed({ ...forced, process: { ...forced.process, killSignalSent: false } }, 'win32', 'NTFS'), false)
  assert.equal(forcedKillPassed({ ...forced, process: { ...forced.process, signal: null } }, 'win32', 'NTFS'), false)

  const asset = {
    status: 'pass', exitCode: 0, platform: 'darwin', fileSystem: 'APFS',
    entries: ['electron/library/assetGc.test.ts', 'electron/library/assetInventory.test.ts'],
  }
  assert.equal(assetLifecyclePassed(asset, 'darwin', 'APFS'), true)
  assert.equal(assetLifecyclePassed({ ...asset, entries: [] }, 'darwin', 'APFS'), false)
})
