import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'

const root = process.cwd()
const evidenceIndex = process.argv.indexOf('--evidence-root')
const evidenceRoot = path.resolve(evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : path.join(root, 'test-results', 'generation-spike'))
const requireComplete = process.argv.includes('--require-complete')

async function collectJson(directory) {
  const found = []
  let entries = []
  try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await collectJson(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.json')) found.push(entryPath)
  }
  return found
}

const reports = []
for (const file of await collectJson(evidenceRoot)) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'))
    if (Array.isArray(value.faultMatrix) && value.disk && value.durability) reports.push({ file, value })
  } catch {
    // 无关 JSON 不参与 Generation 决策。
  }
}
const provenance = await readGitProvenance(root)
const windows = reports.find(({ value }) => value.platform === 'win32' && value.fileSystem === 'NTFS') ?? null
const macos = reports.find(({ value }) => value.platform === 'darwin' && value.fileSystem === 'APFS') ?? null
const failures = []

function verifyPlatform(name, report) {
  if (!report) {
    failures.push(`${name} raw report missing`)
    return null
  }
  const value = report.value
  if (value.gitCommit !== provenance.gitCommit) failures.push(`${name} git commit mismatch`)
  if (value.gitTree !== provenance.gitTree) failures.push(`${name} git tree mismatch`)
  if (value.sourceIdentity !== provenance.sourceIdentity) failures.push(`${name} source identity mismatch`)
  if (requireComplete && value.workingTreeDirty !== false) failures.push(`${name} report was produced from a dirty working tree`)
  if (!value.faultMatrix.every((item) => item.pass)) failures.push(`${name} fault matrix failed`)
  if (!value.recoveryCases.every((item) => item.pass)) failures.push(`${name} recovery matrix failed`)
  if (!value.faultMatrix.every((item) => Number.isFinite(item.recoveryMs) && item.recoveryMs < 5_000)) {
    failures.push(`${name} fault recovery exceeded 5 seconds or was not measured`)
  }
  if (!value.recoveryCases.every((item) => Number.isFinite(item.recoveryMs) && item.recoveryMs < 5_000)) {
    failures.push(`${name} marker recovery exceeded 5 seconds or was not measured`)
  }
  if (!Number.isFinite(value.disk.peakErrorRatio)) failures.push(`${name} disk peak error missing`)
  if (value.disk.peakTargetPass !== true) failures.push(`${name} disk peak target failed`)
  if (!String(value.isolation).includes('no production import')) failures.push(`${name} isolation evidence missing`)
  return {
    file: path.relative(root, report.file).replaceAll('\\', '/'),
    decision: value.decision,
    directoryFsyncSupported: value.durability.directoryFsyncSupported,
    peakErrorRatio: value.disk.peakErrorRatio,
  }
}

const platforms = {
  windows: verifyPlatform('Windows NTFS', windows),
  macos: verifyPlatform('macOS APFS', macos),
}
if (requireComplete && provenance.workingTreeDirty) failures.push('current release working tree is dirty')
const adrPath = path.join(root, 'docs', 'architecture', 'decisions', 'ADR-0001-electron-generation-layout.md')
let adr = ''
try { adr = await fs.readFile(adrPath, 'utf8') } catch { failures.push('Generation ADR missing') }
if (!/状态：No-Go/.test(adr) || !/不部分上线/.test(adr)) failures.push('ADR does not declare unconditional No-Go')
if (!/不创建实施 Epic/.test(adr)) failures.push('ADR incorrectly permits a Generation Epic')

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  platforms,
  adr: path.relative(root, adrPath).replaceAll('\\', '/'),
  decision: 'NO_GO',
  status: failures.length === 0 ? 'pass' : 'hold',
  failures,
}
const outputDirectory = path.join(root, 'test-results', 'generation-spike')
await fs.mkdir(outputDirectory, { recursive: true })
await fs.writeFile(path.join(outputDirectory, 'generation-decision.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (requireComplete && failures.length > 0) process.exitCode = 1
