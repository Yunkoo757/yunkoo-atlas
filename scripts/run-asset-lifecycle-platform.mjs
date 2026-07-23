import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { detectFileSystem } from './file-system-type.mjs'

const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null

const entries = [
  'electron/library/assetGc.test.ts',
  'electron/library/assetInventory.test.ts',
]
const result = spawnSync(
  process.execPath,
  ['scripts/run-regression-tests.mjs', '--unit-only', ...entries],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error

const provenance = await readGitProvenance(root)
const fileSystem = detectFileSystem(root)
const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
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
  entries,
  exitCode: result.status,
  status: result.status === 0 ? 'pass' : 'fail',
}
const outputPath = path.resolve(explicitOutput ?? path.join(
  'test-results',
  'platform-evidence',
  `asset-lifecycle-${platformName}-${fileSystem.toLowerCase()}.json`,
))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (result.status !== 0) process.exitCode = result.status ?? 1
