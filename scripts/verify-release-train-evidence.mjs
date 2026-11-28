import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

import { SCHEMA_VERSION } from '../src/storage/types.ts'
import { readGitProvenance } from './git-provenance.mjs'
import { readEvidenceReports, selectEvidenceReport } from './evidence-reports.mjs'
import {
  APPROVED_BLOB_BRIDGE,
  blobBridgeContractPassed,
  blobBridgeCoveragePassed,
  detectBlobReleaseMode,
  forcedKillPassed,
  jsonCompatibilityPassed,
  persistenceReleaseGatePassed,
} from './release-evidence-validation.mjs'
import { releaseTrainDrillsPassed } from './release-train-drills.mjs'
import { generationDecisionPassed, generationRawPassed } from './spikes/electron-generation/evidence.mjs'
import { fullQaPassed } from './release-qa-plan.mjs'
import { assetLifecyclePassed, electronSafetyPassed } from './platform-regression.mjs'

const root = process.cwd()
const evidenceIndex = process.argv.indexOf('--evidence-root')
const evidenceRoot = path.resolve(evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : root)
const releaseTargetIndex = process.argv.indexOf('--release-target')
const releaseTarget = releaseTargetIndex >= 0 ? process.argv[releaseTargetIndex + 1] : 'web'
if (!['web', 'desktop'].includes(releaseTarget)) throw new Error(`unsupported release target: ${releaseTarget}`)
const requireComplete = process.argv.includes('--require-complete')

const { reports, problems } = await readEvidenceReports(evidenceRoot === root ? path.join(root, 'test-results') : evidenceRoot, 4)
const provenance = await readGitProvenance(root)
const packageVersion = JSON.parse(fsSync.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const indexedDbSource = fsSync.readFileSync(path.join(root, 'src', 'storage', 'indexedDbAdapter.ts'), 'utf8')
const storageProviderSource = fsSync.readFileSync(path.join(root, 'src', 'storage', 'provider.ts'), 'utf8')
const releaseMode = detectBlobReleaseMode(indexedDbSource)
const checks = []

function check(name, filename, predicate, { external = false } = {}) {
  const candidates = reports.filter(({ file }) => {
    const base = path.basename(file)
    return typeof filename === 'string' ? base === filename : filename.test(base)
  })
  const { report, problem } = selectEvidenceReport(candidates)
  const reasons = [...problems]
  if (problem) reasons.push(problem)
  else {
    const { value } = report
    if (!predicate(value)) reasons.push('reported status is not pass')
    if (!external) {
      if (value.gitCommit !== provenance.gitCommit) reasons.push('git commit mismatch')
      if (value.gitTree !== provenance.gitTree) reasons.push('git tree mismatch')
      if (value.sourceIdentity !== provenance.sourceIdentity) reasons.push('source identity mismatch')
      if (requireComplete && value.workingTreeDirty !== false) reasons.push('release evidence was produced from a dirty working tree')
    }
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

function internalCheck(name, pass, reasons = []) {
  const result = { name, pass, file: null, reasons: pass ? [] : reasons }
  checks.push(result)
  return result
}

const qa = check(
  'full-qa',
  'qa-release-full.json',
  fullQaPassed,
)
const jsonCompatibility = check(
  'json-compatibility',
  'json-compatibility.json',
  jsonCompatibilityPassed,
)
const performance = check(
  'persistence-release-gate',
  'persistence-release-gate.json',
  persistenceReleaseGatePassed,
)
const drills = check(
  'release-train-drills',
  'release-train-drills.json',
  releaseTrainDrillsPassed,
)
const forcedWindows = check(
  'forced-kill-windows',
  /^forced-kill-windows-.*\.json$/i,
  (value) => forcedKillPassed(value, 'win32', 'NTFS', SCHEMA_VERSION),
)
const forcedMac = check(
  'forced-kill-macos',
  /^forced-kill-macos-.*\.json$/i,
  (value) => forcedKillPassed(value, 'darwin', 'APFS', SCHEMA_VERSION),
)
const electronSafetyWindows = check(
  'electron-safety-windows',
  /^electron-safety-windows-.*\.json$/i,
  (value) => electronSafetyPassed(value, 'win32', 'NTFS'),
)
const electronSafetyMac = check(
  'electron-safety-macos',
  /^electron-safety-macos-.*\.json$/i,
  (value) => electronSafetyPassed(value, 'darwin', 'APFS'),
)
const assetWindows = check(
  'asset-lifecycle-windows',
  /^asset-lifecycle-windows-.*\.json$/i,
  (value) => assetLifecyclePassed(value, 'win32', 'NTFS'),
)
const assetMac = check(
  'asset-lifecycle-macos',
  /^asset-lifecycle-macos-.*\.json$/i,
  (value) => assetLifecyclePassed(value, 'darwin', 'APFS'),
)
const generationWindows = check(
  'generation-windows',
  /^generation-spike-windows-.*\.json$/i,
  (value) => generationRawPassed(value, 'win32', 'NTFS'),
)
const generationMac = check(
  'generation-macos',
  /^generation-spike-macos-.*\.json$/i,
  (value) => generationRawPassed(value, 'darwin', 'APFS'),
)
const generationDecision = check(
  'generation-decision',
  'generation-decision.json',
  generationDecisionPassed,
)
const desktopStorageIsolation = internalCheck(
  'desktop-storage-isolation',
  storageProviderSource.includes('isElectron() ? getElectronAdapter() : getIndexedDbAdapter()'),
  ['Electron release does not select the dedicated Electron storage adapter'],
)
const blobBridgeContract = internalCheck(
  'blob-bridge-contract',
  blobBridgeContractPassed({ releaseMode, gitCommit: provenance.gitCommit, version: packageVersion }),
  releaseMode === 'bridge'
    ? ['bridge version does not match the approved compatibility contract']
    : ['not an object-only compatibility bridge release'],
)
const blobBridgeCoverage = check(
  'blob-bridge-coverage',
  'blob-bridge-coverage.json',
  blobBridgeCoveragePassed,
  { external: true },
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
    checks: releaseTarget === 'desktop'
      ? [qa, jsonCompatibility, performance, drills]
      : [qa, jsonCompatibility, performance, drills, releaseMode === 'bridge' ? blobBridgeContract : blobBridgeCoverage],
    stop: 'blind put、stale overwrite、冲突恢复失败或正式持久化 SLO 失败即停止 Web 发布',
    rollback: 'Web Locks/通知层可关闭；revision/CAS 不得与 blind writer 混用',
    userRecovery: '导出冲突标签页副本，加载最新版，再由用户决定是否导入副本',
  },
  {
    id: 'release-2',
    checks: [qa, drills, desktopStorageIsolation, forcedWindows, forcedMac, electronSafetyWindows, electronSafetyMac],
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
  blobBridgeCoverage: {
    status: releaseTarget === 'desktop'
      ? 'not-applicable'
      : (releaseMode === 'bridge' ? blobBridgeContract.pass : blobBridgeCoverage.pass) ? 'pass' : 'hold',
    evidence: releaseTarget === 'desktop'
      ? [desktopStorageIsolation.name]
      : [releaseMode === 'bridge' ? blobBridgeContract.name : blobBridgeCoverage.name],
  },
}
const requiredGatesPassed = Object.entries(gates).every(([name, gate]) => (
  gate.status === 'pass' || (releaseTarget === 'desktop' && name === 'blobBridgeCoverage' && gate.status === 'not-applicable')
))
const report = {
  version: 1,
  releaseTarget,
  releaseMode,
  approvedBlobBridge: APPROVED_BLOB_BRIDGE,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  checks,
  gates,
  trains,
  releaseCandidate: requireComplete && requiredGatesPassed,
  status: requireComplete && requiredGatesPassed &&
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
