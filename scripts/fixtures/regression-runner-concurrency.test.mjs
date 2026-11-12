import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const runner = fileURLToPath(new URL('../run-regression-tests.mjs', import.meta.url))

test('full unit runs discard stale evidence for a retired browser test', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-retired-runner-test-'))
  try {
    mkdirSync(path.join(root, 'src')); mkdirSync(path.join(root, 'test-results'))
    writeFileSync(path.join(root, 'src/current.test.ts'), 'export function testCurrentFeature() {}\n')
    writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}\n')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'isolated fixture'], { cwd: root })
    const report = path.join(root, 'test-results/quality-execution.json')
    writeFileSync(report, JSON.stringify({ sourceFingerprint: 'old source', executedFiles: { 'src/retired.browser.test.html': 'old hash' } }))
    const child = spawn(process.execPath, [runner, '--unit-only'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject) })
    assert.equal(code, 0, output)
    const result = JSON.parse(readFileSync(report, 'utf8'))
    assert.deepEqual(Object.keys(result.executedFiles), ['src/current.test.ts'])
    assert.deepEqual(Object.keys(result.executedTests), ['src/current.test.ts#testCurrentFeature'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

async function waitForFile(file) {
  const deadline = Date.now() + 15_000
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error('Concurrent runner fixture did not become ready')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function startRunner(root, role) {
  const child = spawn(process.execPath, [runner, '--unit-only', 'src/shared.test.ts'], {
    cwd: root,
    env: { ...process.env, ATLAS_RUNNER_FIXTURE_ROLE: role },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', part => { output += part })
  child.stderr.on('data', part => { output += part })
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve({ code, output }))
  })
  return { child, finished }
}

test('concurrent regression runners retain their own build until completion and clean only owned output', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-regression-runner-test-'))
  const children = []
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, '.tmp-unrelated'))
  writeFileSync(path.join(root, '.tmp-unrelated', 'keep.txt'), 'unrelated output', 'utf8')
  writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}\n', 'utf8')
  writeFileSync(path.join(root, 'src/shared.test.ts'), `
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function testBuildStaysOwnedUntilTestFinishes() {
  if (process.env.ATLAS_RUNNER_FIXTURE_ROLE !== 'first') return
  fs.writeFileSync('first-ready', 'ready', 'utf8')
  const deadline = Date.now() + 15_000
  while (!fs.existsSync('release-first')) {
    if (Date.now() > deadline) throw new Error('fixture release timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  // Another runner may finish while this test is still reading its emitted resources.
  fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
}
`, 'utf8')
  try {
    const first = startRunner(root, 'first')
    children.push(first)
    await waitForFile(path.join(root, 'first-ready'))
    const second = startRunner(root, 'second')
    children.push(second)
    const secondResult = await second.finished
    writeFileSync(path.join(root, 'release-first'), 'released', 'utf8')
    const firstResult = await first.finished
    assert.equal(secondResult.code, 0, secondResult.output)
    assert.equal(firstResult.code, 0, firstResult.output)
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith('.tmp-')), ['.tmp-unrelated'])
    assert.ok(existsSync(path.join(root, '.tmp-unrelated', 'keep.txt')))
  } finally {
    for (const run of children) {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL')
    }
    await Promise.allSettled(children.map(run => run.finished))
    rmSync(root, { recursive: true, force: true })
  }
})
