import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { scenarioExecutionFailures } from './quality-execution.mjs'
import { evaluateReleaseTrainDrills, requiredDrillScenarioIds } from './release-train-drills.mjs'

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
  if (!Array.isArray(qualityContract.executedContractScenarioIds)) failures.push('quality contract scenario list is missing')
} catch (error) {
  failures.push(`quality contract missing or invalid: ${error.message}`)
}
try {
  qualityExecution = await readJson('test-results/quality-execution.json')
  if (qualityExecution.status !== 'pass') failures.push('quality execution status is not pass')
  const registry = await readJson('scripts/quality-scenarios.json')
  if (!Array.isArray(registry)) throw new Error('expected a scenario list')
  scenarios = registry
} catch (error) {
  failures.push(`quality execution or scenario registry missing or invalid: ${error.message}`)
}

const contracted = new Set(Array.isArray(qualityContract?.executedContractScenarioIds) ? qualityContract.executedContractScenarioIds : [])
const scenarioFailures = []
const verified = []
for (const scenarioId of requiredDrillScenarioIds()) {
  const scenario = scenarios.find(candidate => candidate.id === scenarioId)
  if (!scenario) {
    scenarioFailures.push(`drill scenario is not registered: ${scenarioId}`)
    continue
  }
  const problems = await scenarioExecutionFailures(root, scenario, qualityExecution)
  scenarioFailures.push(...problems)
  if (contracted.has(scenarioId) && !problems.length) {
    verified.push(scenarioId)
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

const trains = evaluateReleaseTrainDrills(failures.length ? [] : verified)
failures.push(...scenarioFailures)
for (const train of trains) {
  for (const [phase, value] of Object.entries(train.phases)) {
    if (value.status !== 'pass') failures.push(`${train.id} ${phase} evidence missing: ${value.missingScenarioIds.join(', ')}`)
  }
}

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
