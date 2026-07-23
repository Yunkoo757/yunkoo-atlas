import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { detectFileSystem } from './file-system-type.mjs'

const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null
const entry = 'electron/platformSafety.test.ts'
const expected = [
  { id: 'E-PATH-PERM', test: 'testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary' },
  { id: 'E-QUIT-BACKUP-FAIL', test: 'testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable' },
]
const result = spawnSync(
  process.execPath,
  ['scripts/run-regression-tests.mjs', '--unit-only', entry],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error

const provenance = await readGitProvenance(root)
const fileSystem = detectFileSystem(root)
const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
const scenarios = expected.map(({ id, test }) => ({
  id,
  testId: `${entry}#${test}`,
  pass: result.status === 0 && (result.stdout ?? '').includes(`PASS ${entry} :: ${test}`),
}))
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
  runtime: { node: process.version },
  scenarios,
  exitCode: result.status,
  status: result.status === 0 && scenarios.every((scenario) => scenario.pass) ? 'pass' : 'fail',
}
const outputPath = path.resolve(explicitOutput ?? path.join(
  'test-results',
  'platform-evidence',
  `electron-safety-${platformName}-${fileSystem.toLowerCase()}.json`,
))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, status: report.status, scenarios }, null, 2))
if (report.status !== 'pass') process.exitCode = 1
