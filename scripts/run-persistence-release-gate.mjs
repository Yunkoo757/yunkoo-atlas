import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  collectPersistenceMetrics,
  findRelativeRegressions,
  validateApprovedPersistenceBaseline,
  validatePersistenceMetrics,
} from './persistence-baseline.mjs'

const root = process.cwd()
const reportDirectory = path.join(root, 'test-results', 'persistence-benchmark')
const approvedBaselinePath = path.join(root, 'scripts', 'persistence-approved-baseline.json')

function run(command, args) {
  const result = spawnSync(process.execPath, [command, ...args], { cwd: root, encoding: 'utf8' })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

async function runAttempt(number) {
  run('scripts/benchmark-persistence.mjs', ['--release'])
  run('scripts/benchmark-web-zip.mjs', ['--release'])
  const persistence = JSON.parse(await fs.readFile(path.join(reportDirectory, 'persistence-release.json'), 'utf8'))
  const webZip = JSON.parse(await fs.readFile(path.join(reportDirectory, 'web-zip-release.json'), 'utf8'))
  if (persistence.gitCommit !== webZip.gitCommit) throw new Error('性能报告不是同一 git SHA')
  if (persistence.sourceIdentity !== webZip.sourceIdentity) {
    throw new Error('性能报告不是同一源码身份')
  }
  return {
    number,
    gitCommit: persistence.gitCommit,
    gitTree: persistence.gitTree,
    workingTreeDirty: persistence.workingTreeDirty,
    sourceFingerprint: persistence.sourceFingerprint,
    sourceIdentity: persistence.sourceIdentity,
    metrics: validatePersistenceMetrics(
      collectPersistenceMetrics(persistence, webZip),
      `attempt ${number} metrics`,
    ),
  }
}

await fs.mkdir(reportDirectory, { recursive: true })
const first = await runAttempt(1)
let baseline
try {
  baseline = JSON.parse(await fs.readFile(approvedBaselinePath, 'utf8'))
} catch {
  const candidate = {
    version: 1,
    approvedBy: null,
    approvedAt: null,
    gitCommit: first.gitCommit,
    gitTree: first.gitTree,
    workingTreeDirty: first.workingTreeDirty,
    sourceFingerprint: first.sourceFingerprint,
    sourceIdentity: first.sourceIdentity,
    metrics: first.metrics,
  }
  await fs.writeFile(path.join(reportDirectory, 'persistence-baseline-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`, 'utf8')
  throw new Error('缺少经用户批准的 scripts/persistence-approved-baseline.json；已生成候选基线，发布保持阻断')
}
validateApprovedPersistenceBaseline(baseline)

const attempts = [first]
let regressions = findRelativeRegressions(baseline.metrics, first.metrics)
if (regressions.length > 0) {
  const second = await runAttempt(2)
  if (second.gitCommit !== first.gitCommit) throw new Error('性能重跑期间 git SHA 变化')
  if (second.sourceIdentity !== first.sourceIdentity) throw new Error('性能重跑期间源码身份发生变化')
  attempts.push(second)
  regressions = findRelativeRegressions(baseline.metrics, second.metrics)
}
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: first.gitCommit,
  gitTree: first.gitTree,
  workingTreeDirty: first.workingTreeDirty,
  sourceFingerprint: first.sourceFingerprint,
  sourceIdentity: first.sourceIdentity,
  approvedBaseline: baseline,
  attempts,
  status: regressions.length === 0 ? 'pass' : 'fail',
  regressions,
}
await fs.writeFile(path.join(reportDirectory, 'persistence-release-gate.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (regressions.length > 0) {
  throw new Error(`同 SHA 重跑后仍有 >20% 性能退化：${regressions.map((item) => item.metric).join(', ')}`)
}
console.log('Persistence release gate PASS')
