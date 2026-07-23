import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { readGitProvenance } from './git-provenance.mjs'

export const executionReportPath = (root) => path.join(root, 'test-results', 'quality-execution.json')

export async function hashFile(root, file) {
  const bytes = await fs.readFile(path.join(root, file))
  return createHash('sha256').update(bytes).digest('hex')
}

export async function writeExecutionReport(root, files) {
  const uniqueFiles = [...new Set(files)].sort()
  const executedFiles = {}
  for (const file of uniqueFiles) executedFiles[file] = await hashFile(root, file)
  const provenance = await readGitProvenance(root)
  await fs.mkdir(path.dirname(executionReportPath(root)), { recursive: true })
  await fs.writeFile(executionReportPath(root), `${JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    status: 'pass',
    gitCommit: provenance.gitCommit,
    gitTree: provenance.gitTree,
    workingTreeDirty: provenance.workingTreeDirty,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceIdentity: provenance.sourceIdentity,
    executedFiles,
  }, null, 2)}\n`, 'utf8')
}
