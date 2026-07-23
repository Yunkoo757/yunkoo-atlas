import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  CUTOVER_FAULT_POINTS,
  MiB,
  commitGeneration,
  createScenarioRoot,
  generationPayload,
  initializePrototype,
  recoverGeneration,
} from './generation-prototype.mjs'
import { detectFileSystem } from '../../file-system-type.mjs'
import { readGitProvenance } from '../../git-provenance.mjs'

const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-generation-spike-'))

function runFault(name, options = {}) {
  const scenarioRoot = createScenarioRoot(workspace, name.replaceAll(':', '-'))
  const oldPayload = generationPayload('generation-000', 'old', 256 * 1024, 256 * 1024)
  const newPayload = generationPayload('generation-001', 'new', 256 * 1024, 256 * 1024)
  initializePrototype(scenarioRoot, oldPayload)
  const result = commitGeneration(scenarioRoot, newPayload, options)
  const recoveryStartedAt = performance.now()
  const recovered = recoverGeneration(scenarioRoot)
  const recoveryMs = performance.now() - recoveryStartedAt
  const neverMixed = recovered.label === 'old' || recovered.label === 'new'
  return {
    name,
    expectedFailure: true,
    observedFailure: !result.ok,
    code: result.code ?? null,
    recovered: recovered.label,
    recoverySource: recovered.source,
    recoveryMs,
    neverMixed,
    pass: !result.ok && neverMixed && recoveryMs < 5_000,
  }
}

function measuredRecovery(root) {
  const startedAt = performance.now()
  const recovered = recoverGeneration(root)
  return { recovered, recoveryMs: performance.now() - startedAt }
}

try {
  const fileSystem = detectFileSystem(workspace)
  const faultResults = CUTOVER_FAULT_POINTS.map((point) => runFault(point, { injectAt: point }))
  const probeRoot = createScenarioRoot(workspace, 'budget-probe')
  initializePrototype(probeRoot, generationPayload('generation-000', 'old', 8 * MiB, 8 * MiB))
  const budgetResult = commitGeneration(
    probeRoot,
    generationPayload('generation-001', 'new', 10 * MiB, 10 * MiB),
  )
  const diskFullInitial = runFault('disk-full-initial', { initialFreeBytes: 0 })
  const diskFullSwitch = runFault('disk-full-switch', { switchFreeBytes: 0 })
  const targetOccupied = runFault('target-occupied', { occupyPointerTemp: true })
  const exdev = runFault('cross-volume-exdev', { forceExdev: true })

  const missingMarkerRoot = createScenarioRoot(workspace, 'marker-missing')
  initializePrototype(missingMarkerRoot, generationPayload('generation-000', 'old'))
  fs.rmSync(path.join(missingMarkerRoot, 'CURRENT'))
  const missingMarkerRecovery = measuredRecovery(missingMarkerRoot)

  const corruptMarkerRoot = createScenarioRoot(workspace, 'marker-corrupt')
  initializePrototype(corruptMarkerRoot, generationPayload('generation-000', 'old'))
  fs.writeFileSync(path.join(corruptMarkerRoot, 'CURRENT'), '{not-json', 'utf8')
  const corruptMarkerRecovery = measuredRecovery(corruptMarkerRoot)

  const incompleteRoot = createScenarioRoot(workspace, 'incomplete-generation')
  initializePrototype(incompleteRoot, generationPayload('generation-000', 'old'))
  fs.mkdirSync(path.join(incompleteRoot, 'generations', 'generation-001'))
  fs.writeFileSync(path.join(incompleteRoot, 'generations', 'generation-001', 'journal.db'), 'partial')
  fs.writeFileSync(path.join(incompleteRoot, 'CURRENT'), JSON.stringify({ version: 1, generation: 'generation-001' }))
  const incompleteRecovery = measuredRecovery(incompleteRoot)

  const incompleteOldRoot = createScenarioRoot(workspace, 'incomplete-old-generation')
  initializePrototype(incompleteOldRoot, generationPayload('generation-000', 'old'))
  const completedNew = commitGeneration(
    incompleteOldRoot,
    generationPayload('generation-001', 'new'),
  )
  if (!completedNew.ok) throw new Error('无法建立 incomplete-old 恢复场景的完整新代')
  fs.rmSync(path.join(incompleteOldRoot, 'generations', 'generation-000', 'journal.db'))
  const incompleteOldRecovery = measuredRecovery(incompleteOldRoot)

  const activeLibraryBytes = 16 * MiB
  const measuredAdditionalPeakBytes = Math.max(0, budgetResult.initialFreeBytes - budgetResult.minimumFreeBytes)
  const predictedAdditionalPeakBytes = budgetResult.budget.expandedTemp + budgetResult.budget.rollbackCopy
  const peakErrorRatio = predictedAdditionalPeakBytes === 0
    ? null
    : Math.abs(measuredAdditionalPeakBytes - predictedAdditionalPeakBytes) / predictedAdditionalPeakBytes
  const peakTargetBytes = activeLibraryBytes * 2.2 + 512 * MiB
  const platformSupported =
    (process.platform === 'win32' && fileSystem === 'NTFS') ||
    (process.platform === 'darwin' && fileSystem === 'APFS')
  const allFaults = [
    ...faultResults,
    diskFullInitial,
    diskFullSwitch,
    targetOccupied,
    exdev,
  ]
  const recoveryCases = [
    { name: 'marker-missing', recovered: missingMarkerRecovery.recovered.label, recoveryMs: missingMarkerRecovery.recoveryMs, pass: missingMarkerRecovery.recovered.label === 'old' && missingMarkerRecovery.recoveryMs < 5_000 },
    { name: 'marker-corrupt', recovered: corruptMarkerRecovery.recovered.label, recoveryMs: corruptMarkerRecovery.recoveryMs, pass: corruptMarkerRecovery.recovered.label === 'old' && corruptMarkerRecovery.recoveryMs < 5_000 },
    { name: 'incomplete-generation', recovered: incompleteRecovery.recovered.label, recoveryMs: incompleteRecovery.recoveryMs, pass: incompleteRecovery.recovered.label === 'old' && incompleteRecovery.recoveryMs < 5_000 },
    { name: 'incomplete-old-generation', recovered: incompleteOldRecovery.recovered.label, recoveryMs: incompleteOldRecovery.recoveryMs, pass: incompleteOldRecovery.recovered.label === 'new' && incompleteOldRecovery.recoveryMs < 5_000 },
  ]
  const faultMatrixPass = allFaults.every((item) => item.pass) && recoveryCases.every((item) => item.pass)
  const goEligible = platformSupported && faultMatrixPass && budgetResult.ok &&
    budgetResult.directoryFsyncSupported && budgetResult.peakTreeBytes <= peakTargetBytes
  const provenance = await readGitProvenance(root)
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    fileSystem,
    gitCommit: provenance.gitCommit,
    gitTree: provenance.gitTree,
    workingTreeDirty: provenance.workingTreeDirty,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceIdentity: provenance.sourceIdentity,
    isolation: 'scripts/spikes/electron-generation only; no production import',
    recoverySloMs: 5_000,
    faultMatrix: allFaults,
    recoveryCases,
    disk: {
      formula: 'requiredFree = expandedTemp + rollbackCopy + max(512 MiB, operationBytes * 10%)',
      ...budgetResult.budget,
      initialFreeBytes: budgetResult.initialFreeBytes,
      minimumFreeBytes: budgetResult.minimumFreeBytes,
      measuredAdditionalPeakBytes,
      predictedAdditionalPeakBytes,
      peakErrorRatio,
      measuredTreePeakBytes: budgetResult.peakTreeBytes,
      peakTargetBytes,
      peakTargetPass: budgetResult.peakTreeBytes <= peakTargetBytes,
    },
    durability: {
      fileFsyncExercised: true,
      directoryFsyncSupported: budgetResult.directoryFsyncSupported,
    },
    decision: goEligible ? 'GO_ELIGIBLE_ON_THIS_PLATFORM' : 'NO_GO_ON_THIS_PLATFORM',
    reasons: [
      ...(!platformSupported ? [`unsupported filesystem ${fileSystem}`] : []),
      ...(!faultMatrixPass ? ['fault matrix failure'] : []),
      ...(!budgetResult.directoryFsyncSupported ? ['directory fsync durability barrier unavailable'] : []),
      ...(!budgetResult.ok ? ['happy-path cutover failed'] : []),
      ...(budgetResult.peakTreeBytes > peakTargetBytes ? ['disk peak target exceeded'] : []),
    ],
  }
  const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const outputPath = path.resolve(explicitOutput ?? path.join(
    'test-results',
    'generation-spike',
    `generation-spike-${platformName}-${fileSystem.toLowerCase()}.json`,
  ))
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, decision: report.decision, faultMatrixPass, disk: report.disk }, null, 2))
  if (!faultMatrixPass) process.exitCode = 1
} finally {
  fs.rmSync(workspace, { recursive: true, force: true })
}
