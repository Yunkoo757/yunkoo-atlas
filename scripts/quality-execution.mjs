import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import { assertLocalSourceUnchanged, hasSameLocalSource, readGitProvenance } from './git-provenance.mjs'

export const executionReportPath = (root) => path.join(root, 'test-results', 'quality-execution.json')

export async function hashFile(root, file) {
  const bytes = await fs.readFile(path.join(root, file))
  return createHash('sha256').update(bytes).digest('hex')
}

export async function writeExecutionReport(root, provenance, files, tests) {
  const reportPath = executionReportPath(root)
  let previous
  try {
    previous = JSON.parse(await fs.readFile(reportPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }

  const executedFiles = {}
  for (const file of [...new Set(files)].sort()) executedFiles[file] = await hashFile(root, file)
  const executedTests = {}
  for (const testId of [...new Set(tests)].sort()) {
    const separator = testId.indexOf('#')
    const file = testId.slice(0, separator)
    if (separator <= 0 || !Object.hasOwn(executedFiles, file)) {
      throw new Error(`invalid quality test ID: ${testId}`)
    }
    executedTests[testId] = executedFiles[file]
  }
  const prior = hasSameLocalSource(previous, provenance) ? previous : null
  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    status: 'pass',
    ...provenance,
    executedFiles: { ...prior?.executedFiles, ...executedFiles },
    executedTests: { ...prior?.executedTests, ...executedTests },
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  const temporary = `${reportPath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(report, null, 2) + '\n', 'utf8')
    assertLocalSourceUnchanged(provenance, await readGitProvenance(root))
    await fs.rename(temporary, reportPath)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
