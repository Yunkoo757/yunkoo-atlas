import fs from 'node:fs/promises'
import path from 'node:path'
import { run } from 'node:test'
import { tap } from 'node:test/reporters'
import { pipeline } from 'node:stream/promises'

import { readGitProvenance } from './git-provenance.mjs'
import { discoverQualityNodeTests } from './test-discovery.mjs'
import { executionReportPath, writeExecutionReport } from './quality-execution.mjs'

const root = process.cwd()
await fs.rm(executionReportPath(root), { force: true })
const provenance = await readGitProvenance(root)
const files = await discoverQualityNodeTests(root)
const selected = new Set(files)
const passed = new Set()
const tests = []
let failed = false

async function* recordResults(events) {
  for await (const event of events) {
    const { type, data } = event
    if (type === 'test:fail' || (type === 'test:pass' && (data.skip || data.todo))) failed = true
    if (type === 'test:pass' && data.file && !data.skip && !data.todo) {
      const file = path.relative(root, data.file).split(path.sep).join('/')
      if (selected.has(file)) {
        passed.add(file)
        tests.push(`${file}#${data.name}`)
      }
    }
    yield event
  }
}

await pipeline(run({ files, concurrency: true }), recordResults, tap, process.stdout, { end: false })
if (failed) {
  throw new Error('关键 Node 场景存在失败、跳过或待办，拒绝生成 PASS 执行报告')
}
await writeExecutionReport(root, provenance, [...passed], tests)
