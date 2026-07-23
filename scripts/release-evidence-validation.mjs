import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  findRelativeRegressions,
  validateRawPersistenceAttempt,
  validateApprovedPersistenceBaseline,
  validatePersistenceMetrics,
} from './persistence-baseline.mjs'
import { CUTOVER_FAULT_POINTS, MiB } from './spikes/electron-generation/generation-prototype.mjs'

const JSON_COMPATIBILITY_SCRIPT_SHA256 = createHash('sha256')
  .update(readFileSync(new URL('./measure-json-import-compatibility.mjs', import.meta.url)))
  .digest('hex')

export const EXPECTED_DRILL_TRAIN_IDS = ['release-0', 'release-1', 'release-2', 'release-3']
export const EXPECTED_FINAL_CHECK_NAMES = [
  'full-qa',
  'json-compatibility',
  'persistence-release-gate',
  'release-train-drills',
  'forced-kill-windows',
  'forced-kill-macos',
  'electron-safety-windows',
  'electron-safety-macos',
  'asset-lifecycle-windows',
  'asset-lifecycle-macos',
  'generation-windows',
  'generation-macos',
  'generation-decision',
]

export function fullQaPassed(value) {
  const expectedCommands = [
    'qa:ci', 'qa:sidebar', 'qa', 'qa:linear', 'build:app', 'qa:dashboard-10k', 'qa:electron',
  ]
  return value?.version === 1 && value.mode === 'full' && value.status === 'pass' &&
    Array.isArray(value.commands) && value.commands.length === expectedCommands.length &&
    expectedCommands.every((command, index) => value.commands[index] === command)
}

export function persistenceReleaseGatePassed(value) {
  try {
    if (value?.version !== 1 || value.status !== 'pass' || !Array.isArray(value.regressions) || value.regressions.length !== 0) return false
    validateApprovedPersistenceBaseline(value.approvedBaseline)
    if (!Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > 2) return false
    const attemptRegressions = value.attempts.map((attempt, index) => {
      validatePersistenceMetrics(attempt.metrics, `attempts[${index}].metrics`)
      const raw = validateRawPersistenceAttempt(attempt.raw, value)
      for (const [metric, measured] of Object.entries(raw.metrics)) {
        if (attempt.metrics[metric] !== measured) throw new Error(`attempts[${index}].${metric} raw mismatch`)
      }
      if (attempt.number === index + 1 &&
        attempt.gitCommit === value.gitCommit &&
        attempt.gitTree === value.gitTree &&
        attempt.sourceFingerprint === value.sourceFingerprint &&
        attempt.sourceIdentity === value.sourceIdentity &&
        attempt.workingTreeDirty === false) {
        return findRelativeRegressions(value.approvedBaseline.metrics, attempt.metrics)
      }
      throw new Error(`attempts[${index}] provenance mismatch`)
    })
    if (attemptRegressions.at(-1).length !== 0) return false
    return attemptRegressions.length === 1 || attemptRegressions[0].length > 0
  } catch {
    return false
  }
}

export function finalQualityManifestPassed(value, provenance) {
  return value?.version === 1 && value.status === 'pass' && value.releaseCandidate === true &&
    value.gitCommit === provenance.gitCommit && value.gitTree === provenance.gitTree &&
    value.sourceFingerprint === provenance.sourceFingerprint && value.sourceIdentity === provenance.sourceIdentity &&
    value.workingTreeDirty === false && provenance.workingTreeDirty === false &&
    ['normal', 'compatibility', 'performance', 'dualPlatform', 'generation']
      .every((gate) => value.gates?.[gate]?.status === 'pass') &&
    Array.isArray(value.checks) && value.checks.length === EXPECTED_FINAL_CHECK_NAMES.length &&
    value.checks.every((check, index) => check.name === EXPECTED_FINAL_CHECK_NAMES[index] && check.pass === true) &&
    Array.isArray(value.trains) && value.trains.length === EXPECTED_DRILL_TRAIN_IDS.length &&
    value.trains.every((train, index) => train.id === EXPECTED_DRILL_TRAIN_IDS[index] && train.status === 'pass')
}

export function releaseTrainDrillsPassed(value) {
  return value?.status === 'pass' &&
    Array.isArray(value.trains) && value.trains.length === EXPECTED_DRILL_TRAIN_IDS.length &&
    value.trains.every((train, index) => (
      train.id === EXPECTED_DRILL_TRAIN_IDS[index] &&
      train.status === 'pass' &&
      ['stop', 'rollback', 'userRecovery'].every((phase) => train.phases?.[phase]?.status === 'pass')
    ))
}

export function forcedKillPassed(value, platform, fileSystem) {
  return value?.status === 'pass' &&
    value.scenarioId === 'E-FORCED-KILL' &&
    value.platform === platform && value.fileSystem === fileSystem &&
    value.process?.runtime === 'electron-main' &&
    typeof value.process?.electronVersion === 'string' && value.process.electronVersion.length > 0 &&
    value.process?.mainProcessPid === value.process?.childPid &&
    value.process?.saveStartingObserved === true &&
    typeof value.process?.atomicTempFileObserved === 'string' && value.process.atomicTempFileObserved.length > 0 &&
    typeof value.process?.killRequestedAt === 'string' && value.process.killRequestedAt.length > 0 &&
    value.process?.killSignalSent === true &&
    value.process?.signal === 'SIGKILL' && value.process?.exitCode === null &&
    value.process?.saveCompletedAcknowledged === false &&
    value.recovery?.lastConfirmedRecovered === true &&
    value.recovery?.unconfirmedMemoryEditPromised === false &&
    value.recovery?.unconfirmedPendingRevisionAbsent === true
}

export function assetLifecyclePassed(value, platform, fileSystem) {
  const expectedEntries = ['electron/library/assetGc.test.ts', 'electron/library/assetInventory.test.ts']
  return value?.status === 'pass' && value.exitCode === 0 &&
    value.platform === platform && value.fileSystem === fileSystem &&
    Array.isArray(value.entries) &&
    value.entries.length === expectedEntries.length &&
    expectedEntries.every((entry) => value.entries.includes(entry))
}

export function electronSafetyPassed(value, platform, fileSystem) {
  const expected = [
    {
      id: 'E-PATH-PERM',
      testId: 'electron/platformSafety.test.ts#testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary',
    },
    {
      id: 'E-QUIT-BACKUP-FAIL',
      testId: 'electron/platformSafety.test.ts#testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable',
    },
  ]
  return value?.version === 1 && value.status === 'pass' && value.exitCode === 0 &&
    value.platform === platform && value.fileSystem === fileSystem &&
    Array.isArray(value.scenarios) && value.scenarios.length === expected.length &&
    expected.every((scenario, index) => value.scenarios[index]?.id === scenario.id &&
      value.scenarios[index]?.pass === true && value.scenarios[index]?.testId === scenario.testId)
}

export function jsonCompatibilityPassed(value) {
  const expectedCorpus = [
    'dense-1k', 'dense-10k', 'dense-20k', 'shared-self-reference', 'max-declared-attachment',
  ]
  const limits = value?.limits
  const corpus = value?.corpus
  const sizes = corpus?.map((item) => item.entities)
  return value?.version === 1 && value.hardLimitsEnabled === true &&
    value.generatorCommit === value.gitCommit && value.workingTreeDirty === false &&
    value.generatorScriptSha256 === JSON_COMPATIBILITY_SCRIPT_SHA256 &&
    value.seed === 20_260_715 &&
    limits?.fileBytes === 64 * MiB && limits?.singleAttachmentDecodedBytes === 32 * MiB &&
    limits?.totalAttachmentDecodedBytes === 48 * MiB && limits?.entities === 50_000 &&
    value.approval?.status === 'approved' && value.approval?.approvedBy === 'Yunkoo' &&
    typeof value.approval?.approvedAt === 'string' && value.approval.approvedAt.length > 0 &&
    typeof value.approval?.basis === 'string' && value.approval.basis.length > 0 &&
    Array.isArray(corpus) && corpus.length === expectedCorpus.length &&
    expectedCorpus.every((name, index) => corpus[index]?.name === name &&
      corpus[index]?.compatible === true && corpus[index]?.importOk === true &&
      corpus[index]?.importCode === null && Number.isInteger(corpus[index]?.bytes) && corpus[index].bytes > 0 &&
      corpus[index].bytes <= limits.fileBytes && /^[a-f0-9]{64}$/.test(corpus[index]?.sha256)) &&
    new Set(corpus.map((item) => item.sha256)).size === expectedCorpus.length &&
    sizes[0] >= 1_000 && sizes[1] >= 10_000 && sizes[2] >= 20_000 &&
    sizes[0] < sizes[1] && sizes[1] < sizes[2] &&
    Array.isArray(corpus[3].attachmentDecodedBytes) && corpus[3].attachmentDecodedBytes.length === 1 &&
    corpus[3].attachmentDecodedBytes[0] > 0 &&
    Array.isArray(corpus[4].attachmentDecodedBytes) && corpus[4].attachmentDecodedBytes.length === 1 &&
    corpus[4].attachmentDecodedBytes[0] === limits.singleAttachmentDecodedBytes
}

export function generationRawPassed(value, platform, fileSystem) {
  const expectedFaults = [
    ...CUTOVER_FAULT_POINTS,
    'disk-full-initial',
    'disk-full-switch',
    'target-occupied',
    'cross-volume-exdev',
  ]
  const expectedRecovery = [
    ['marker-missing', 'old'],
    ['marker-corrupt', 'old'],
    ['incomplete-generation', 'old'],
    ['incomplete-old-generation', 'new'],
  ]
  const disk = value?.disk
  const expectedDecision = value?.durability?.directoryFsyncSupported === true
    ? 'GO_ELIGIBLE_ON_THIS_PLATFORM'
    : 'NO_GO_ON_THIS_PLATFORM'
  const durabilityReasonPresent = Array.isArray(value?.reasons) &&
    value.reasons.includes('directory fsync durability barrier unavailable')
  return value?.version === 1 && value?.platform === platform && value.fileSystem === fileSystem &&
    value.decision === expectedDecision && value.workingTreeDirty === false &&
    value.recoverySloMs === 5_000 &&
    value.isolation === 'scripts/spikes/electron-generation only; no production import' &&
    Array.isArray(value.faultMatrix) && value.faultMatrix.length === expectedFaults.length &&
    expectedFaults.every((name, index) => value.faultMatrix[index]?.name === name &&
      value.faultMatrix[index]?.expectedFailure === true &&
      value.faultMatrix[index]?.observedFailure === true &&
      value.faultMatrix[index]?.neverMixed === true &&
      value.faultMatrix[index]?.pass === true &&
      Number.isFinite(value.faultMatrix[index]?.recoveryMs) && value.faultMatrix[index].recoveryMs < 5_000) &&
    Array.isArray(value.recoveryCases) && value.recoveryCases.length === expectedRecovery.length &&
    expectedRecovery.every(([name, recovered], index) => value.recoveryCases[index]?.name === name &&
      value.recoveryCases[index]?.recovered === recovered && value.recoveryCases[index]?.pass === true &&
      Number.isFinite(value.recoveryCases[index]?.recoveryMs) && value.recoveryCases[index].recoveryMs < 5_000) &&
    disk?.formula === 'requiredFree = expandedTemp + rollbackCopy + max(512 MiB, operationBytes * 10%)' &&
    Number.isFinite(disk.expandedTemp) && Number.isFinite(disk.rollbackCopy) &&
    Number.isFinite(disk.operationBytes) && Number.isFinite(disk.safetyReserve) &&
    disk.safetyReserve === Math.max(512 * MiB, Math.ceil(disk.operationBytes * 0.1)) &&
    disk.requiredFree === disk.expandedTemp + disk.rollbackCopy + disk.safetyReserve &&
    disk.predictedAdditionalPeakBytes === disk.expandedTemp + disk.rollbackCopy &&
    Number.isFinite(disk.peakErrorRatio) && disk.peakErrorRatio >= 0 && disk.peakTargetPass === true &&
    value.durability?.fileFsyncExercised === true &&
    durabilityReasonPresent === (value.durability?.directoryFsyncSupported === false)
}

export function generationDecisionPassed(value) {
  return value?.version === 1 && value.status === 'pass' && value.decision === 'NO_GO' &&
    value.workingTreeDirty === false && Array.isArray(value.failures) && value.failures.length === 0 &&
    value.platforms?.windows?.decision === 'NO_GO_ON_THIS_PLATFORM' &&
    ['NO_GO_ON_THIS_PLATFORM', 'GO_ELIGIBLE_ON_THIS_PLATFORM'].includes(value.platforms?.macos?.decision) &&
    value.adr === 'docs/architecture/decisions/ADR-0001-electron-generation-layout.md'
}
