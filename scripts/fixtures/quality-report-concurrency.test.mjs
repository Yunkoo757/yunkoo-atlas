import assert from 'node:assert/strict'
import { execFileSync, fork } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import { executionReportPath, resetExecutionReport } from '../quality-execution.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-report-publication-'))
  const git = (...args) => execFileSync('git', args, { cwd: root })
  fs.mkdirSync(path.join(root, 'test-results'))
  fs.writeFileSync(path.join(root, '.gitignore'), 'test-results/\n')
  for (const label of ['first', 'second']) fs.writeFileSync(path.join(root, label + '.ts'), label)
  const script = path.join(root, 'write.mjs')
  fs.writeFileSync(script, [
    "import fs from 'node:fs/promises'",
    "import { setTimeout as delay } from 'node:timers/promises'",
    'import { readGitProvenance } from ' + JSON.stringify(new URL('../git-provenance.mjs', import.meta.url).href),
    'import { writeExecutionReport } from ' + JSON.stringify(new URL('../quality-execution.mjs', import.meta.url).href),
    'const role = process.argv[2]',
    'const baseline = await readGitProvenance()',
    "const read = fs.readFile.bind(fs)",
    "fs.readFile = async (file, ...options) => {",
    "  if (!String(file).endsWith('quality-execution.json')) return read(file, ...options)",
    "  const prior = await read(file, ...options).then(value => ({value}), error => ({error}))",
    "  process.send({phase:'read', role})",
    "  if (process.argv[3] === 'hold') await new Promise(() => { setInterval(() => {}, 1000) })",
    "  await delay(350)",
    "  if (prior.error) throw prior.error",
    "  return prior.value",
    "}",
    "process.send({phase:'ready', role})",
    "await new Promise(resolve => process.once('message', resolve))",
    "const file = role + '.ts'",
    "await writeExecutionReport(process.cwd(), baseline, [file], [file + '#passed'])",
  ].join('\n'))
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'fixture')
  const children = []
  t.after(async () => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await Promise.allSettled(children.map(run => run.finished))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const start = (role, mode = '') => {
    const child = fork(script, [role, mode], { cwd: root, silent: true, execArgv: [] })
    let stderr = ''
    child.stderr.on('data', part => { stderr += part })
    const finished = once(child, 'close').then(([code]) => ({code, stderr}))
    const ready = once(child, 'message')
    const run = { child, ready, finished }
    children.push(run)
    return run
  }
  return { root, start, report: executionReportPath(root) }
}

test('同一源码的两个报告写入进程均保留已通过的文件和用例', { timeout: 20_000 }, async t => {
  const { report, start } = fixture(t)
  const runs = [start('first'), start('second')]
  await Promise.all(runs.map(run => run.ready))
  for (const run of runs) run.child.send('publish')
  for (const result of await Promise.all(runs.map(run => run.finished))) assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(report, 'utf8'))
  assert.deepEqual(Object.keys(data.executedFiles).sort(), ['first.ts', 'second.ts'])
  assert.deepEqual(Object.keys(data.executedTests).sort(), ['first.ts#passed', 'second.ts#passed'])
})

test('写入进程意外终止后可以失效旧报告并重新发布', { timeout: 20_000 }, async t => {
  const { root, report, start } = fixture(t)
  const writer = start('first', 'hold')
  await writer.ready
  const reading = once(writer.child, 'message')
  writer.child.send('publish')
  await reading
  writer.child.kill('SIGKILL')
  await writer.finished
  // The owner has actually exited. Age the directory past the heartbeat window.
  const expired = new Date(Date.now() - 60_000)
  fs.utimesSync(report + '.lock', expired, expired)
  await resetExecutionReport(root)
  const next = start('second')
  await next.ready
  next.child.send('publish')
  const result = await next.finished
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(report)).executedFiles), ['second.ts'])
})
