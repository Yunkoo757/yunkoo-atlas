import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { executionReportPath, writeExecutionReport } from './quality-execution.mjs'

const root = process.cwd()
await fs.rm(executionReportPath(root), { force: true })
const fixtureFiles = (await fs.readdir(path.join(root, 'scripts/fixtures')))
  .filter((file) => file.endsWith('.test.mjs'))
  .map((file) => `scripts/fixtures/${file}`)
const files = [
  'scripts/release-command.test.mjs',
  'scripts/release-artifacts.test.mjs',
  'scripts/test-discovery.test.mjs',
  ...fixtureFiles,
]
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  cwd: root,
  encoding: 'utf8',
})
if (result.error) throw result.error
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.status !== 0) process.exit(result.status ?? 1)
if (/^\s*ok\b.*#\s+(?:SKIP|TODO)\b/im.test(result.stdout ?? '')) {
  throw new Error('关键 Node 场景包含 skip/todo，拒绝生成 PASS 执行报告')
}
const tests = []
for (const file of files) {
  const source = await fs.readFile(path.join(root, file), 'utf8')
  for (const match of source.matchAll(/\btest\(\s*['"`]([^'"`]+)['"`]/g)) {
    tests.push(`${file}#${match[1]}`)
  }
}
await writeExecutionReport(root, files, tests)
