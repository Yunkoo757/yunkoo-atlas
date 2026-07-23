import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import {
  assetLifecyclePassed,
  electronSafetyPassed,
  forcedKillPassed,
  fullQaPassed,
  generationDecisionPassed,
  generationRawPassed,
  jsonCompatibilityPassed,
  persistenceReleaseGatePassed,
  releaseTrainDrillsPassed,
} from './release-evidence-validation.mjs'

const root = process.cwd()
const evidenceIndex = process.argv.indexOf('--evidence-root')
const evidenceRoot = path.resolve(evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : root)
const requireComplete = process.argv.includes('--require-complete')

async function collectJson(directory, depth = 0) {
  if (depth > 4) return []
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectJson(entryPath, depth + 1))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(entryPath)
  }
  return files
}

async function loadReports() {
  const searchRoots = evidenceRoot === root
    ? [path.join(root, 'test-results'), path.join(root, 'docs', 'superpowers', 'reports')]
    : [evidenceRoot]
  const files = (await Promise.all(searchRoots.map((directory) => collectJson(directory)))).flat()
  const reports = []
  for (const file of files) {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'))
      reports.push({ file, value, parseError: null })
    } catch (error) {
      reports.push({ file, value: null, parseError: error.message })
    }
  }
  return reports
}

function findReports(reports, predicate) {
  return reports.filter(({ value, file }) => predicate(value, path.basename(file)))
}

const reports = await loadReports()
const provenance = await readGitProvenance(root)
const checks = []

function check(name, matchingReports, predicate = (value) => value.status === 'pass') {
  const reasons = []
  const report = matchingReports.length === 1 ? matchingReports[0] : null
  if (matchingReports.length === 0) reasons.push('missing report')
  else if (matchingReports.length > 1) reasons.push(`ambiguous reports: ${matchingReports.length}`)
  if (report?.parseError) reasons.push(`invalid JSON: ${report.parseError}`)
  else if (report) {
    if (!predicate(report.value)) reasons.push(`reported status is not pass`)
    if (report.value.gitCommit !== provenance.gitCommit) reasons.push('git commit mismatch')
    if (report.value.gitTree !== provenance.gitTree) reasons.push('git tree mismatch')
    if (report.value.sourceIdentity !== provenance.sourceIdentity) reasons.push('source identity mismatch')
    if (requireComplete && report.value.workingTreeDirty !== false) reasons.push('release evidence was produced from a dirty working tree')
  }
  if (requireComplete && provenance.workingTreeDirty) reasons.push('current release working tree is dirty')
  const result = {
    name,
    pass: reasons.length === 0,
    file: report ? path.relative(root, report.file).replaceAll('\\', '/') : null,
    reasons,
  }
  checks.push(result)
  return result
}

const qa = check(
  'full-qa',
  findReports(reports, (_value, name) => name === 'qa-release-full.json'),
  fullQaPassed,
)
const jsonCompatibility = check(
  'json-compatibility',
  findReports(reports, (_value, name) => name === 'json-compatibility.json'),
  jsonCompatibilityPassed,
)
const performance = check(
  'persistence-release-gate',
  findReports(reports, (_value, name) => name === 'persistence-release-gate.json'),
  persistenceReleaseGatePassed,
)
const drills = check(
  'release-train-drills',
  findReports(reports, (_value, name) => name === 'release-train-drills.json'),
  releaseTrainDrillsPassed,
)
const forcedWindows = check(
  'forced-kill-windows',
  findReports(reports, (_value, name) => /^forced-kill-windows-.*\.json$/i.test(name)),
  (value) => forcedKillPassed(value, 'win32', 'NTFS'),
)
const forcedMac = check(
  'forced-kill-macos',
  findReports(reports, (_value, name) => /^forced-kill-macos-.*\.json$/i.test(name)),
  (value) => forcedKillPassed(value, 'darwin', 'APFS'),
)
const electronSafetyWindows = check(
  'electron-safety-windows',
  findReports(reports, (_value, name) => /^electron-safety-windows-.*\.json$/i.test(name)),
  (value) => electronSafetyPassed(value, 'win32', 'NTFS'),
)
const electronSafetyMac = check(
  'electron-safety-macos',
  findReports(reports, (_value, name) => /^electron-safety-macos-.*\.json$/i.test(name)),
  (value) => electronSafetyPassed(value, 'darwin', 'APFS'),
)
const assetWindows = check(
  'asset-lifecycle-windows',
  findReports(reports, (_value, name) => /^asset-lifecycle-windows-.*\.json$/i.test(name)),
  (value) => assetLifecyclePassed(value, 'win32', 'NTFS'),
)
const assetMac = check(
  'asset-lifecycle-macos',
  findReports(reports, (_value, name) => /^asset-lifecycle-macos-.*\.json$/i.test(name)),
  (value) => assetLifecyclePassed(value, 'darwin', 'APFS'),
)
const generationWindows = check(
  'generation-windows',
  findReports(reports, (_value, name) => /^generation-spike-windows-.*\.json$/i.test(name)),
  (value) => generationRawPassed(value, 'win32', 'NTFS'),
)
const generationMac = check(
  'generation-macos',
  findReports(reports, (_value, name) => /^generation-spike-macos-.*\.json$/i.test(name)),
  (value) => generationRawPassed(value, 'darwin', 'APFS'),
)
const generationDecision = check(
  'generation-decision',
  findReports(reports, (_value, name) => name === 'generation-decision.json'),
  generationDecisionPassed,
)

const trainDefinitions = [
  {
    id: 'release-0',
    checks: [qa, drills],
    stop: '任一 v8 四路径合同、qa:full 或双平台构建失败即停止 publish',
    rollback: '回滚 reader/writer 与 runner 变更，但保留全量合同 fixture',
    userRecovery: '从发布前完整 .journal.zip 恢复；恢复前先导出当前可读库',
  },
  {
    id: 'release-1',
    checks: [qa, jsonCompatibility, performance, drills],
    stop: 'blind put、stale overwrite、冲突恢复失败或正式持久化 SLO 失败即停止 Web 发布',
    rollback: 'Web Locks/通知层可关闭；revision/CAS 不得与 blind writer 混用',
    userRecovery: '导出冲突标签页副本，加载最新版，再由用户决定是否导入副本',
  },
  {
    id: 'release-2',
    checks: [qa, drills, forcedWindows, forcedMac, electronSafetyWindows, electronSafetyMac],
    stop: '路径 fail-open、退出步骤重复/遗漏或任一平台强杀恢复失败即停止桌面发布',
    rollback: '保留路径 fail-closed，回滚协调层；不回滚已确认数据文件',
    userRecovery: '重启核对最后确认数据；异常时从已验证备份恢复，不承诺内存编辑',
  },
  {
    id: 'release-3',
    checks: [qa, drills, assetWindows, assetMac],
    stop: '共享附件误删、backup vault 改变、新孤儿或 stale dry-run 仍执行即停止发布',
    rollback: '关闭 GC；Electron 从应用 .trash 恢复，Web 不执行过期事务',
    userRecovery: '使用操作前恢复归档；物理删除后不声称可由浏览器自动恢复',
  },
]

const trains = trainDefinitions.map((train) => ({
  id: train.id,
  status: train.checks.every((item) => item.pass) ? 'pass' : 'hold',
  evidence: train.checks.map((item) => item.name),
  stop: train.stop,
  rollback: train.rollback,
  userRecovery: train.userRecovery,
}))
const gates = {
  normal: {
    status: qa.pass && drills.pass ? 'pass' : 'hold',
    evidence: [qa.name, drills.name],
  },
  compatibility: {
    status: jsonCompatibility.pass ? 'pass' : 'hold',
    evidence: [jsonCompatibility.name],
  },
  performance: {
    status: performance.pass ? 'pass' : 'hold',
    evidence: [performance.name],
  },
  dualPlatform: {
    status: [forcedWindows, forcedMac, electronSafetyWindows, electronSafetyMac, assetWindows, assetMac]
      .every((item) => item.pass) ? 'pass' : 'hold',
    evidence: [
      forcedWindows.name, forcedMac.name, electronSafetyWindows.name, electronSafetyMac.name,
      assetWindows.name, assetMac.name,
    ],
  },
  generation: {
    status: [generationWindows, generationMac, generationDecision].every((item) => item.pass) ? 'pass' : 'hold',
    evidence: [generationWindows.name, generationMac.name, generationDecision.name],
  },
}
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  checks,
  gates,
  trains,
  releaseCandidate: requireComplete && Object.values(gates).every((gate) => gate.status === 'pass'),
  status: requireComplete && Object.values(gates).every((gate) => gate.status === 'pass') &&
    trains.every((train) => train.status === 'pass') ? 'pass' : 'hold',
}
const outputDirectory = path.join(root, 'test-results', 'release-trains')
await fs.mkdir(outputDirectory, { recursive: true })
await fs.writeFile(
  path.join(outputDirectory, 'release-train-evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
await fs.writeFile(
  path.join(outputDirectory, 'final-quality-manifest.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify({ status: report.status, trains, checks }, null, 2))
if (requireComplete && report.status !== 'pass') process.exitCode = 1
