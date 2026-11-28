import { CUTOVER_FAULT_POINTS, MiB } from './generation-prototype.mjs'

// Generation 目录布局决策维持 No-Go，原始报告仍记录各自平台的实测能力。
export const GENERATION_LAYOUT_POLICY = 'generation-layout-no-go'

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
    typeof value.durability.directoryFsyncSupported === 'boolean' &&
    durabilityReasonPresent === (value.durability?.directoryFsyncSupported === false)
}

export function generationPlatformsMatchDecision(platforms) {
  return platforms?.windows?.decision === 'NO_GO_ON_THIS_PLATFORM' &&
    ['NO_GO_ON_THIS_PLATFORM', 'GO_ELIGIBLE_ON_THIS_PLATFORM'].includes(platforms?.macos?.decision)
}

export function generationDecisionPassed(value) {
  return value?.version === 1 && value.status === 'pass' && value.decision === 'NO_GO' &&
    value.workingTreeDirty === false && Array.isArray(value.failures) && value.failures.length === 0 &&
    generationPlatformsMatchDecision(value.platforms) &&
    value.adr === GENERATION_LAYOUT_POLICY
}
