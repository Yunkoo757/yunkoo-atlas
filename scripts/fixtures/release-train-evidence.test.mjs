import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

import {
  assetLifecyclePassed,
  electronSafetyPassed,
  EXPECTED_FINAL_CHECK_NAMES,
  finalQualityManifestPassed,
  forcedKillPassed,
  fullQaPassed,
  generationDecisionPassed,
  generationRawPassed,
  jsonCompatibilityPassed,
  persistenceReleaseGatePassed,
  releaseTrainDrillsPassed,
} from '../release-evidence-validation.mjs'
import { PERSISTENCE_BASELINE_METRICS } from '../persistence-baseline.mjs'
import { CUTOVER_FAULT_POINTS, MiB } from '../spikes/electron-generation/generation-prototype.mjs'

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
  assert.match(source, /electronSafetyPassed\(value, 'win32', 'NTFS'\)/)
  assert.match(source, /electronSafetyPassed\(value, 'darwin', 'APFS'\)/)
  assert.match(source, /generationRawPassed\(value, 'win32', 'NTFS'\)/)
  assert.match(source, /generationRawPassed\(value, 'darwin', 'APFS'\)/)
  assert.match(source, /forced-kill-windows/)
  assert.match(source, /forced-kill-macos/)
  assert.match(source, /asset-lifecycle-windows/)
  assert.match(source, /asset-lifecycle-macos/)
  assert.match(source, /electron-safety-windows/)
  assert.match(source, /electron-safety-macos/)
  assert.match(source, /generation-decision/)
  assert.match(source, /requireComplete && report\.status !== 'pass'/)
  assert.match(source, /final-quality-manifest\.json/)
  assert.match(source, /normal:/)
  assert.match(source, /performance:/)
  assert.match(source, /dualPlatform:/)
  assert.match(source, /compatibility:/)
  assert.match(source, /generation:/)
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
  const samples = new Array(30).fill(1)
  const webResult = (label) => ({
    label,
    saveSamplesMs: samples,
    dirtyConfirmedSamplesMs: samples,
    staleConflictSamplesMs: samples,
    longTaskSamplesMs: [1],
    longTaskObserverSupported: true,
    longTaskCalibrationObserved: true,
  })
  const electronResult = (label) => ({
    label,
    saveSamplesMs: samples,
    ...(label === '10k' ? { quitSamplesMs: samples } : {}),
  })
  const rawPersistenceJson = `${JSON.stringify({
    version: 1,
    mode: 'release',
    generatedAt: '2026-07-22T00:00:00.000Z',
    gitCommit: 'a'.repeat(40),
    gitTree: 'b'.repeat(40),
    workingTreeDirty: false,
    sourceFingerprint: 'c'.repeat(64),
    sourceIdentity: `git-tree:${'b'.repeat(40)}`,
    sampleConfig: { warmups: 5, samples: 30 },
    environment: { os: 'win32', cpu: 'test', chromium: '1', electron: '1', sqlJs: '1' },
    generator: { datasets: [
      { label: '10k', sha256: 'd'.repeat(64) },
      { label: '20k', sha256: 'e'.repeat(64) },
    ] },
    web: [webResult('10k'), webResult('20k')],
    electron: [electronResult('10k'), electronResult('20k')],
    summaries: {
      web10kSaveP95Ms: 1, web20kSaveP95Ms: 1,
      web10kDirtyConfirmedP95Ms: 1, web20kDirtyConfirmedP95Ms: 1,
      web10kStaleConflictP95Ms: 1, web20kStaleConflictP95Ms: 1,
      electron10kSaveP95Ms: 1, electron20kSaveP95Ms: 1,
      quitCoordinatorP95Ms: 1, web10kMaxLongTaskMs: 1, web20kMaxLongTaskMs: 1,
    },
    status: 'pass',
  }, null, 2)}\n`
  const rawWebZipJson = `${JSON.stringify({
    version: 1,
    mode: 'release',
    generatedAt: '2026-07-22T00:01:00.000Z',
    gitCommit: 'a'.repeat(40),
    gitTree: 'b'.repeat(40),
    workingTreeDirty: false,
    sourceFingerprint: 'c'.repeat(64),
    sourceIdentity: `git-tree:${'b'.repeat(40)}`,
    peakJsHeapBytes: 1,
    status: 'pass',
  }, null, 2)}\n`
  const raw = {
    persistence: { json: rawPersistenceJson, sha256: createHash('sha256').update(rawPersistenceJson).digest('hex') },
    webZip: { json: rawWebZipJson, sha256: createHash('sha256').update(rawWebZipJson).digest('hex') },
  }
  const baselineEvidence = [1, 2].map((attempt) => ({
    attempt,
    persistence: { path: `scripts/persistence-baseline-evidence/test/${attempt}/persistence.json`, sha256: 'f'.repeat(64) },
    webZip: { path: `scripts/persistence-baseline-evidence/test/${attempt}/web-zip.json`, sha256: 'f'.repeat(64) },
  }))
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
      gitCommit: 'a'.repeat(40),
      gitTree: 'b'.repeat(40),
      workingTreeDirty: false,
      sourceFingerprint: 'c'.repeat(64),
      sourceIdentity: `git-tree:${'b'.repeat(40)}`,
      basis: 'two raw formal attempts',
      evidence: baselineEvidence,
      metrics,
    },
    attempts: [{
      number: 1,
      gitCommit: 'a'.repeat(40),
      gitTree: 'b'.repeat(40),
      workingTreeDirty: false,
      sourceFingerprint: 'c'.repeat(64),
      sourceIdentity: `git-tree:${'b'.repeat(40)}`,
      raw,
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
  }), false)
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
      compatibility: { status: 'pass' },
      performance: { status: 'pass' },
      dualPlatform: { status: 'pass' },
      generation: { status: 'pass' },
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

  const safety = {
    version: 1, status: 'pass', exitCode: 0, platform: 'darwin', fileSystem: 'APFS',
    scenarios: [
      {
        id: 'E-PATH-PERM',
        testId: 'electron/platformSafety.test.ts#testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary',
        pass: true,
      },
      {
        id: 'E-QUIT-BACKUP-FAIL',
        testId: 'electron/platformSafety.test.ts#testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable',
        pass: true,
      },
    ],
  }
  assert.equal(electronSafetyPassed(safety, 'darwin', 'APFS'), true)
  assert.equal(electronSafetyPassed({ ...safety, scenarios: safety.scenarios.slice(0, 1) }, 'darwin', 'APFS'), false)
  assert.equal(electronSafetyPassed({
    ...safety,
    scenarios: [{ ...safety.scenarios[0], testId: 'fake#test' }, safety.scenarios[1]],
  }, 'darwin', 'APFS'), false)

  const compatibility = {
    version: 1,
    hardLimitsEnabled: true,
    generatorCommit: 'a'.repeat(40),
    gitCommit: 'a'.repeat(40),
    workingTreeDirty: false,
    generatorScriptSha256: createHash('sha256')
      .update(fs.readFileSync('scripts/measure-json-import-compatibility.mjs'))
      .digest('hex'),
    seed: 20_260_715,
    limits: {
      fileBytes: 64 * MiB,
      singleAttachmentDecodedBytes: 32 * MiB,
      totalAttachmentDecodedBytes: 48 * MiB,
      entities: 50_000,
    },
    approval: { status: 'approved', approvedBy: 'Yunkoo', approvedAt: '2026-07-22', basis: 'approved fixture' },
    corpus: ['dense-1k', 'dense-10k', 'dense-20k', 'shared-self-reference', 'max-declared-attachment']
      .map((name, index) => ({
        name,
        compatible: true,
        importOk: true,
        importCode: null,
        bytes: 1_000 + index,
        sha256: String(index + 1).repeat(64),
        entities: [1_000, 10_000, 20_000, 1_000, 1_000][index],
        attachmentDecodedBytes: index === 3 ? [24] : index === 4 ? [32 * MiB] : [],
      })),
  }
  assert.equal(jsonCompatibilityPassed(compatibility), true)
  assert.equal(jsonCompatibilityPassed({ ...compatibility, workingTreeDirty: true }), false)
  assert.equal(jsonCompatibilityPassed({ ...compatibility, generatorScriptSha256: 'b'.repeat(64) }), false)
  assert.equal(jsonCompatibilityPassed({ ...compatibility, corpus: compatibility.corpus.slice(0, 1) }), false)

  const expectedFaults = [
    ...CUTOVER_FAULT_POINTS,
    'disk-full-initial', 'disk-full-switch', 'target-occupied', 'cross-volume-exdev',
  ]
  const generation = {
    version: 1,
    platform: 'darwin', fileSystem: 'APFS', decision: 'NO_GO_ON_THIS_PLATFORM', workingTreeDirty: false,
    recoverySloMs: 5_000,
    faultMatrix: expectedFaults.map((name) => ({
      name, expectedFailure: true, observedFailure: true, neverMixed: true, pass: true, recoveryMs: 1,
    })),
    recoveryCases: [
      ['marker-missing', 'old'],
      ['marker-corrupt', 'old'],
      ['incomplete-generation', 'old'],
      ['incomplete-old-generation', 'new'],
    ].map(([name, recovered]) => ({ name, recovered, pass: true, recoveryMs: 1 })),
    disk: {
      formula: 'requiredFree = expandedTemp + rollbackCopy + max(512 MiB, operationBytes * 10%)',
      expandedTemp: 20, rollbackCopy: 10, operationBytes: 20,
      safetyReserve: 512 * MiB, requiredFree: 30 + 512 * MiB,
      predictedAdditionalPeakBytes: 30, peakErrorRatio: 0.01, peakTargetPass: true,
    },
    durability: { fileFsyncExercised: true, directoryFsyncSupported: false },
    reasons: ['directory fsync durability barrier unavailable'],
    isolation: 'scripts/spikes/electron-generation only; no production import',
  }
  assert.equal(generationRawPassed(generation, 'darwin', 'APFS'), true)
  assert.equal(generationRawPassed({ ...generation, faultMatrix: [{ pass: false, recoveryMs: 1 }] }, 'darwin', 'APFS'), false)
  assert.equal(generationRawPassed({
    ...generation,
    decision: 'GO_ELIGIBLE_ON_THIS_PLATFORM',
    durability: { fileFsyncExercised: true, directoryFsyncSupported: true },
    reasons: [],
  }, 'darwin', 'APFS'), true)
  const decision = {
    version: 1, status: 'pass', decision: 'NO_GO', workingTreeDirty: false, failures: [],
    platforms: {
      windows: { decision: 'NO_GO_ON_THIS_PLATFORM' },
      macos: { decision: 'GO_ELIGIBLE_ON_THIS_PLATFORM' },
    },
    adr: 'docs/architecture/decisions/ADR-0001-electron-generation-layout.md',
  }
  assert.equal(generationDecisionPassed(decision), true)
  assert.equal(generationDecisionPassed({ ...decision, platforms: { windows: decision.platforms.windows, macos: null } }), false)
})
