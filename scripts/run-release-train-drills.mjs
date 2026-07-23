import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { hashFile } from './quality-execution.mjs'
import { evaluateReleaseTrainDrills } from './release-train-drills.mjs'

const root = process.cwd()
const requireComplete = process.argv.includes('--require-complete')

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
}

const failures = []
let qualityContract = null
let qualityExecution = null
let scenarios = []
try {
  qualityContract = await readJson('test-results/quality-contract.json')
  if (qualityContract.status !== 'pass' || qualityContract.executionRequired !== true) {
    failures.push('quality contract was not produced by a passing execution-required gate')
  }
} catch (error) {
  failures.push(`quality contract missing or invalid: ${error.message}`)
}
try {
  qualityExecution = await readJson('test-results/quality-execution.json')
  if (qualityExecution.status !== 'pass') failures.push('quality execution status is not pass')
  scenarios = await readJson('scripts/quality-scenarios.json')
} catch (error) {
  failures.push(`quality execution or scenario registry missing or invalid: ${error.message}`)
}

const trains = evaluateReleaseTrainDrills(qualityContract?.executedScenarioIds ?? [])
const requiredScenarioIds = new Set(trains.flatMap((train) => (
  Object.values(train.phases).flatMap((phase) => phase.scenarioIds)
)))
for (const scenarioId of requiredScenarioIds) {
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId)
  if (!scenario) {
    failures.push(`drill scenario is not registered: ${scenarioId}`)
    continue
  }
  for (const file of scenario.evidence) {
    try {
      const currentHash = await hashFile(root, file)
      if (qualityExecution?.executedFiles?.[file] !== currentHash) {
        failures.push(`drill evidence was not executed with current content: ${scenarioId} -> ${file}`)
      }
    } catch (error) {
      failures.push(`drill evidence is unavailable: ${scenarioId} -> ${file}: ${error.message}`)
    }
  }
}
for (const train of trains) {
  for (const [phase, value] of Object.entries(train.phases)) {
    if (value.status !== 'pass') failures.push(`${train.id} ${phase} evidence missing: ${value.missingScenarioIds.join(', ')}`)
  }
}

const provenance = await readGitProvenance(root)
for (const [name, evidence] of [
  ['quality contract', qualityContract],
  ['quality execution', qualityExecution],
]) {
  if (evidence?.gitCommit !== provenance.gitCommit) failures.push(`${name} git commit mismatch`)
  if (evidence?.gitTree !== provenance.gitTree) failures.push(`${name} git tree mismatch`)
  if (evidence?.sourceIdentity !== provenance.sourceIdentity) failures.push(`${name} source identity mismatch`)
}
if (requireComplete && provenance.workingTreeDirty) failures.push('current release working tree is dirty')

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  qualityContractGeneratedAt: qualityContract?.generatedAt ?? null,
  qualityExecutionGeneratedAt: qualityExecution?.generatedAt ?? null,
  trains,
  status: failures.length === 0 ? 'pass' : 'hold',
  failures,
}

const outputDirectory = path.join(root, 'test-results', 'release-trains')
await fs.mkdir(outputDirectory, { recursive: true })
await fs.writeFile(path.join(outputDirectory, 'release-train-drills.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exitCode = 1
