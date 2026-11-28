import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  findRelativeRegressions,
  validateRawPersistenceAttempt,
  validateApprovedPersistenceBaseline,
  validatePersistenceMetrics,
} from './persistence-baseline.mjs'
import { MiB } from './spikes/electron-generation/generation-prototype.mjs'

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
  'desktop-storage-isolation',
  'blob-bridge-contract',
  'blob-bridge-coverage',
]

export const APPROVED_BLOB_BRIDGE = Object.freeze({
  commit: '9d7f8e85c13e045ea28af32682bd2694aca527cd',
  version: '1.2.25',
  artifactSha256: '3d9699d90b36adc0c37a1c46602525d8ab13f89a40a40feb42f744280c5ebdf3',
  minimumCoverageMs: 24 * 60 * 60 * 1_000,
})

export function detectBlobReleaseMode(indexedDbSource) {
  const dualReader = indexedDbSource.includes('storedSnapshot instanceof Blob')
  const objectWriter = indexedDbSource.includes('storedSnapshot: input.snapshot')
  const blobWriter = indexedDbSource.includes('serializeSnapshotToBlobCooperatively(input.snapshot)')
  if (dualReader && objectWriter && !blobWriter) return 'bridge'
  if (dualReader && blobWriter && !objectWriter) return 'blob-writer'
  return 'invalid'
}

export function blobBridgeContractPassed(value) {
  return value?.releaseMode === 'bridge' &&
    value.version === APPROVED_BLOB_BRIDGE.version
}

export function blobBridgeCoveragePassed(value) {
  const startedAt = Date.parse(value?.coverageStartedAt)
  const endedAt = Date.parse(value?.coverageEndedAt)
  return value?.version === 1 && value.status === 'pass' &&
    value.bridgeCommit === APPROVED_BLOB_BRIDGE.commit &&
    value.bridgeVersion === APPROVED_BLOB_BRIDGE.version &&
    value.deployedArtifactSha256?.toLowerCase() === APPROVED_BLOB_BRIDGE.artifactSha256 &&
    value.writerMode === 'object-only' &&
    Array.isArray(value.readerModes) && value.readerModes.join(',') === 'object,blob' &&
    Number.isFinite(startedAt) && Number.isFinite(endedAt) &&
    endedAt - startedAt >= APPROVED_BLOB_BRIDGE.minimumCoverageMs &&
    typeof value.operator === 'string' && value.operator.trim().length > 0 &&
    value.oldTabsRefreshedOrClosed === true
}

export function persistenceReleaseGatePassed(value) {
  try {
    if (value?.version !== 1 || value.status !== 'pass' || !Array.isArray(value.regressions) || value.regressions.length !== 0) return false
    const localComparable = value.benchmarkProfile === 'local' && value.relativeBaselineComparable === true
    const hostedNonComparable = value.benchmarkProfile === 'hosted-windows' &&
      value.relativeBaselineComparable === false &&
      value.relativeBaselineReason === 'hosted runner hardware is not comparable to the approved local baseline'
    if (!localComparable && !hostedNonComparable) return false
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
        return localComparable
          ? findRelativeRegressions(value.approvedBaseline.metrics, attempt.metrics)
          : []
      }
      throw new Error(`attempts[${index}] provenance mismatch`)
    })
    if (hostedNonComparable) return attemptRegressions.length === 1
    if (attemptRegressions.at(-1).length !== 0) return false
    return attemptRegressions.length === 1 || attemptRegressions[0].length > 0
  } catch {
    return false
  }
}

export function finalQualityManifestPassed(value, provenance) {
  const webModeCheck = value?.releaseMode === 'bridge'
    ? value.checks?.find((check) => check.name === 'blob-bridge-contract')?.pass === true
    : value?.releaseMode === 'blob-writer'
      ? value.checks?.find((check) => check.name === 'blob-bridge-coverage')?.pass === true
      : false
  const desktopScopeCheck = value?.checks
    ?.find((check) => check.name === 'desktop-storage-isolation')?.pass === true
  const targetCheck = value?.releaseTarget === 'web'
    ? value.gates?.blobBridgeCoverage?.status === 'pass' && webModeCheck
    : value?.releaseTarget === 'desktop'
      ? value.gates?.blobBridgeCoverage?.status === 'not-applicable' && desktopScopeCheck
      : false
  return value?.version === 1 && value.status === 'pass' && value.releaseCandidate === true &&
    value.gitCommit === provenance.gitCommit && value.gitTree === provenance.gitTree &&
    value.sourceFingerprint === provenance.sourceFingerprint && value.sourceIdentity === provenance.sourceIdentity &&
    value.workingTreeDirty === false && provenance.workingTreeDirty === false &&
    ['normal', 'compatibility', 'performance', 'dualPlatform', 'generation']
      .every((gate) => value.gates?.[gate]?.status === 'pass') &&
    Array.isArray(value.checks) && value.checks.length === EXPECTED_FINAL_CHECK_NAMES.length &&
    value.checks.every((check, index) => check.name === EXPECTED_FINAL_CHECK_NAMES[index]) &&
    value.checks.slice(0, -2).every((check) => check.pass === true) && targetCheck &&
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

export function forcedKillPassed(value, platform, fileSystem, expectedSchemaVersion) {
  const expectedMigrationBoundaries = [
    'before-database-replace',
    'after-database-replace',
    'after-manifest-replace',
  ]
  const migrationBoundaries = Array.isArray(value?.schemaMigration)
    ? value.schemaMigration.map((item) => item?.boundary)
    : []
  const sameStageGraph = Array.isArray(value?.recovery?.liveStageIds) &&
    Array.isArray(value?.recovery?.expectedLiveStageIds) &&
    value.recovery.liveStageIds.length > 0 &&
    JSON.stringify(value.recovery.liveStageIds) === JSON.stringify(value.recovery.expectedLiveStageIds)

  return value?.status === 'pass' &&
    value.scenarioId === 'E-FORCED-KILL' &&
    Number.isSafeInteger(expectedSchemaVersion) && value.schemaVersion === expectedSchemaVersion &&
    value.platform === platform && value.fileSystem === fileSystem &&
    typeof value.gitCommit === 'string' && value.gitCommit.length > 0 &&
    typeof value.gitTree === 'string' && value.gitTree.length > 0 &&
    typeof value.sourceIdentity === 'string' && value.sourceIdentity.length > 0 &&
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
    value.recovery?.unconfirmedPendingRevisionAbsent === true &&
    sameStageGraph &&
    Array.isArray(value.recovery.currentTradeIds) && value.recovery.currentTradeIds.includes('trade-contract') &&
    Array.isArray(value.recovery.archiveTradeIds) && value.recovery.archiveTradeIds.includes('trade-archive-contract') &&
    value.recovery.liveArchiveScopeRecovered === true &&
    typeof value.recovery.snapshotRevision === 'string' && value.recovery.snapshotRevision.length > 0 &&
    value.recovery.snapshotRevision === value.recovery.expectedSnapshotRevision &&
    value.recovery.snapshotRevisionRecovered === true &&
    JSON.stringify(migrationBoundaries) === JSON.stringify(expectedMigrationBoundaries) &&
    value.schemaMigration.every((item) => item?.status === 'pass' && item?.recoveredSchemaVersion === expectedSchemaVersion)
}

export function jsonCompatibilityPassed(value) {
  const expectedCorpus = [
    'dense-1k', 'dense-10k', 'dense-20k', 'shared-self-reference', 'max-declared-attachment',
  ]
  const limits = value?.limits
  const corpus = value?.corpus
  const sizes = corpus?.map((item) => item.entities)
  return value?.version === 1 && value.status === 'pass' && value.hardLimitsEnabled === true &&
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
