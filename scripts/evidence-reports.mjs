import fs from 'node:fs/promises'
import path from 'node:path'

export async function readEvidenceReports(directory, maxDepth = Infinity) {
  const reports = []
  const problems = []
  async function visit(dir, depth) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT' && depth === 0) return
      problems.push(`cannot enumerate evidence directory ${dir}: ${error.message}`)
      return
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules' && depth < maxDepth) {
        await visit(file, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        let value
        try {
          value = JSON.parse(await fs.readFile(file, 'utf8'))
        } catch (error) {
          const reason = error instanceof SyntaxError ? 'invalid JSON' : 'cannot read report'
          reports.push({ file, problem: `${reason}: ${error.message}` })
          continue
        }
        reports.push({ file, value })
      }
    }
  }
  await visit(directory, 0)
  return { reports, problems }
}

export function selectEvidenceReport(candidates) {
  if (candidates.length === 0) return { problem: 'missing report' }
  if (candidates.length !== 1) return { problem: `ambiguous reports: ${candidates.length}` }
  const [report] = candidates
  if (report.problem) return { report, problem: report.problem }
  if (!report.value || typeof report.value !== 'object' || Array.isArray(report.value)) {
    return { report, problem: 'expected a JSON object' }
  }
  return { report }
}
