import { fork } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { hasSameLocalSource, readGitProvenance } from './git-provenance.mjs'
import { detectFileSystem } from './file-system-type.mjs'

const assetLifecycleEntries = ['electron/library/assetGc.test.ts', 'electron/library/assetInventory.test.ts']
const safetyEntry = 'electron/platformSafety.test.ts'
const electronSafetyScenarios = [
  { id: 'E-PATH-PERM', testId: safetyEntry + '#testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary' },
  { id: 'E-QUIT-BACKUP-FAIL', testId: safetyEntry + '#testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable' },
]

export function assetLifecyclePassed(value, platform, fileSystem) {
  return value?.status === 'pass' && value.exitCode === 0 &&
    value.platform === platform && value.fileSystem === fileSystem &&
    Array.isArray(value.entries) &&
    value.entries.length === assetLifecycleEntries.length &&
    assetLifecycleEntries.every((entry) => value.entries.includes(entry))
}

export function electronSafetyPassed(value, platform, fileSystem) {
  return value?.version === 1 && value.status === 'pass' && value.exitCode === 0 &&
    value.platform === platform && value.fileSystem === fileSystem &&
    Array.isArray(value.scenarios) && value.scenarios.length === electronSafetyScenarios.length &&
    electronSafetyScenarios.every((scenario, index) => value.scenarios[index]?.id === scenario.id &&
      value.scenarios[index]?.pass === true && value.scenarios[index]?.testId === scenario.testId)
}

function runEntries(root, entries) {
  const child = fork(path.join(root, 'scripts/run-regression-tests.mjs'), ['--unit-only', ...entries], {
    cwd: root,
    execArgv: [],
  })
  let receipt
  return new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message?.type === 'unit-regression-result') receipt = message
    })
    child.once('error', reject)
    child.once('close', exitCode => resolve({ receipt, exitCode }))
  })
}

export async function runPlatformRegression(name) {
  const root = process.cwd()
  const fileSystem = detectFileSystem(root)
  const platformName = { win32: 'windows', darwin: 'macos' }[process.platform] ?? process.platform
  const outputIndex = process.argv.indexOf('--output')
  const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
  const outputPath = path.resolve(output ?? path.join('test-results', 'platform-evidence', `${name}-${platformName}-${fileSystem.toLowerCase()}.json`))
  await fs.rm(outputPath, { force: true })

  const safety = name === 'electron-safety'
  const entries = safety ? [safetyEntry] : assetLifecycleEntries
  const provenance = await readGitProvenance(root)
  const { receipt, exitCode } = await runEntries(root, entries)
  const completed = exitCode === 0 && entries.every(entry => receipt?.passedEntries.includes(entry))
  const sameSource = hasSameLocalSource(provenance, await readGitProvenance(root))
  const scenarios = safety ? electronSafetyScenarios.map(scenario => ({
    ...scenario,
    pass: sameSource && exitCode === 0 && Boolean(receipt?.passedTests.includes(scenario.testId)),
  })) : undefined
  const pass = sameSource && completed && (scenarios?.every(scenario => scenario.pass) ?? true)
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    fileSystem,
    ...provenance,
    ...(safety ? { scenarios, runtime: { node: process.version } } : { entries }),
    exitCode,
    status: pass ? 'pass' : 'fail',
  }
  if (!sameSource) console.error('平台回归执行期间源码已变化')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ outputPath, status: report.status, scenarios }, null, 2))
  if (!pass) process.exitCode = exitCode || 1
}
