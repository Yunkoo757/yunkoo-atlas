import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { readGitProvenance } from './git-provenance.mjs'

export const executionReportPath = (root) => path.join(root, 'test-results', 'quality-execution.json')

export async function hashFile(root, file) {
  const bytes = await fs.readFile(path.join(root, file))
  return createHash('sha256').update(bytes).digest('hex')
}

export async function writeExecutionReport(root, files, tests = []) {
  let previous = null
  try { previous = JSON.parse(await fs.readFile(executionReportPath(root), 'utf8')) } catch {}
  const uniqueFiles = [...new Set(files)].sort()
  const provenance = await readGitProvenance(root)
  const sameSource = previous?.sourceFingerprint === provenance.sourceFingerprint
  const executedFiles = sameSource ? { ...previous.executedFiles } : {}
  for (const file of uniqueFiles) executedFiles[file] = await hashFile(root, file)
  const executedTests = sameSource ? { ...previous.executedTests } : {}
  for (const testId of [...new Set(tests)].sort()) {
    const separator = testId.indexOf('#')
    if (separator <= 0) throw new Error(`invalid quality test ID: ${testId}`)
    const file = testId.slice(0, separator)
    executedTests[testId] = await hashFile(root, file)
  }
  await fs.mkdir(path.dirname(executionReportPath(root)), { recursive: true })
  await fs.writeFile(executionReportPath(root), `${JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    status: 'pass',
    gitCommit: provenance.gitCommit,
    gitTree: provenance.gitTree,
    workingTreeDirty: provenance.workingTreeDirty,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceIdentity: provenance.sourceIdentity,
    executedFiles,
    executedTests,
  }, null, 2)}\n`, 'utf8')
}
