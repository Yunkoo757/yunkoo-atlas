import {
  findRelativeRegressions,
  validateApprovedPersistenceBaseline,
  validatePersistenceMetrics,
} from './persistence-baseline.mjs'

export const EXPECTED_DRILL_TRAIN_IDS = ['release-0', 'release-1', 'release-2', 'release-3']
export const EXPECTED_FINAL_CHECK_NAMES = [
  'full-qa',
  'persistence-release-gate',
  'release-train-drills',
  'forced-kill-windows',
  'forced-kill-macos',
  'asset-lifecycle-windows',
  'asset-lifecycle-macos',
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
    ['normal', 'performance', 'dualPlatform'].every((gate) => value.gates?.[gate]?.status === 'pass') &&
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
