import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { readEvidenceReports, selectEvidenceReport } from './evidence-reports.mjs'
import { GENERATION_LAYOUT_POLICY, generationPlatformsMatchDecision, generationRawPassed } from './spikes/electron-generation/evidence.mjs'

const root = process.cwd()
const evidenceIndex = process.argv.indexOf('--evidence-root')
const evidenceRoot = path.resolve(evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : path.join(root, 'test-results', 'generation-spike'))
const requireComplete = process.argv.includes('--require-complete')

const { reports, problems } = await readEvidenceReports(evidenceRoot)
const provenance = await readGitProvenance(root)
const failures = [...problems]

function verifyPlatform(platform, fileSystem, artifactPlatform) {
  const name = `${artifactPlatform} ${fileSystem}`
  const candidates = reports.filter(({ file, value }) => {
    const canonical = /^generation-spike-(windows|macos)-.*\.json$/i.exec(path.basename(file))
    if (canonical) return canonical[1].toLowerCase() === artifactPlatform.toLowerCase()
    // Historical runs can supply renamed raw files. Summary reports also live in this directory.
    return value?.platform === platform && value.fileSystem === fileSystem && Array.isArray(value.faultMatrix)
  })
  const { report, problem } = selectEvidenceReport(candidates)
  if (problem) {
    failures.push(`${name} raw report: ${problem}`)
    return null
  }
  const { value } = report
  if (!generationRawPassed(value, platform, fileSystem)) {
    failures.push(`${name} raw report contract invalid`)
    return null
  }
  if (value.gitCommit !== provenance.gitCommit) failures.push(`${name} git commit mismatch`)
  if (value.gitTree !== provenance.gitTree) failures.push(`${name} git tree mismatch`)
  if (value.sourceIdentity !== provenance.sourceIdentity) failures.push(`${name} source identity mismatch`)
  return {
    file: path.relative(root, report.file).replaceAll('\\', '/'),
    decision: value.decision,
    directoryFsyncSupported: value.durability.directoryFsyncSupported,
    peakErrorRatio: value.disk.peakErrorRatio,
  }
}

const platforms = {
  windows: verifyPlatform('win32', 'NTFS', 'Windows'),
  macos: verifyPlatform('darwin', 'APFS', 'macOS'),
}
if (requireComplete && provenance.workingTreeDirty) failures.push('current release working tree is dirty')
if (platforms.windows && platforms.macos && !generationPlatformsMatchDecision(platforms)) {
  failures.push('measured platform decisions differ from the approved Generation policy')
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  platforms,
  adr: GENERATION_LAYOUT_POLICY,
  decision: 'NO_GO',
  status: failures.length === 0 ? 'pass' : 'hold',
  failures,
}
const outputDirectory = path.join(root, 'test-results', 'generation-spike')
await fs.mkdir(outputDirectory, { recursive: true })
await fs.writeFile(path.join(outputDirectory, 'generation-decision.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (requireComplete && failures.length > 0) process.exitCode = 1
