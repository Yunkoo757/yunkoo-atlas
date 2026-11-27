import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const releaseQa = fileURLToPath(new URL('../qa-release.mjs', import.meta.url))

function checkout(parent, name) {
  const root = path.join(parent, name)
  const file = relative => path.join(root, relative)
  for (const dir of ['bin', 'node_modules', 'test-results', 'scripts']) fs.mkdirSync(file(dir), { recursive: true })
  fs.symlinkSync(fileURLToPath(new URL('../../node_modules/vite', import.meta.url)), file('node_modules/vite'), 'junction')
  fs.writeFileSync(file('.gitignore'), 'node_modules\ntest-results/\n')
  fs.writeFileSync(file('index.html'), '<html><head></head><body>QA checkout ' + name + '</body></html>')
  fs.writeFileSync(file('vite.config.mjs'), `
    import { writeFileSync } from 'node:fs'
    export default {
      optimizeDeps: { noDiscovery: true },
      plugins: [{
        name: 'record-listener-close',
        configureServer({ httpServer }) {
          httpServer.once('close', () => writeFileSync('test-results/listener-closed', 'closed'))
        },
      }],
    }
  `)
  const step = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'async function run() {',
    "  const step = process.argv[2] || 'qa:dashboard-10k'",
    "  if (step === 'build:app' && !fs.existsSync('test-results/listener-closed')) throw Error('本工作树的监听器尚未关闭')",
    "  fs.appendFileSync('test-results/commands', step + '\\n')",
    "  if (step === 'qa' || step === 'qa:core') {",
    "    if (process.env.QA_WORKBENCH_PROBE_URL) throw Error('验收不应使用独立探针页面')",
    "    const url = process.env.QA_BASE_URL",
    "    const content = await (await fetch(url)).text()",
    "    if (!content.includes('QA checkout ' + path.basename(process.cwd()))) throw Error('浏览器连接到了另一个工作树')",
    "    fs.writeFileSync('test-results/address', url)",
    "    const until = Date.now() + 15000",
    "    while (fs.existsSync('test-results/hold') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20))",
    '  }',
    "  if (process.env.CHANGE_SOURCE_AT === step) fs.writeFileSync('source.txt', 'changed after checks started')",
    '}',
    'run().catch(error => { console.error(error); process.exitCode = 1 })',
  ].join('\n')
  const cli = file('bin/pnpm')
  fs.writeFileSync(cli, step, { mode: 0o755 })
  fs.writeFileSync(file('scripts/qa-dashboard-10k.mjs'), [
    "import { appendFileSync } from 'node:fs'",
    "if (process.env.QA_BASE_URL) throw Error('性能步骤应使用本次构建的生产预览')",
    "appendFileSync('test-results/commands', 'qa:dashboard-10k\\n')",
  ].join('\n'))
  const git = (...args) => execFileSync('git', args, { cwd: root })
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=QA', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
  return {
    file,
    run(args = [], env = {}) {
      const child = spawn(process.execPath, [releaseQa, ...args], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: file('bin') + path.delimiter + process.env.PATH, npm_execpath: cli, ...env },
      })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => resolve({ code, output }))
      })
    },
  }
}

test('并行验收只访问各自工作树，完整与冒烟报告记录实际通过的命令', { timeout: 35_000 }, async t => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-release-qa-'))
  t.after(() => fs.rmSync(area, { recursive: true, force: true }))
  const first = checkout(area, 'first')
  const second = checkout(area, 'second')
  fs.writeFileSync(first.file('test-results/hold'), '')
  const running = first.run()
  try {
    const deadline = Date.now() + 15_000
    while (!fs.existsSync(first.file('test-results/address'))) {
      if (Date.now() > deadline) throw Error('第一份工作树未启动验收服务')
      await Promise.race([delay(25), running.then(result => { throw Error(result.output) })])
    }
    const other = await second.run(['--full'], {
      QA_BASE_URL: 'http://127.0.0.1:1',
      QA_WORKBENCH_PROBE_URL: 'http://127.0.0.1:1',
    })
    assert.equal(other.code, 0, other.output)
  } finally {
    fs.rmSync(first.file('test-results/hold'), { force: true })
    const result = await running
    assert.equal(result.code, 0, result.output)
  }
  for (const [repo, mode] of [[first, 'smoke'], [second, 'full']]) {
    assert.equal(fs.readFileSync(repo.file('test-results/listener-closed'), 'utf8'), 'closed')
    const report = JSON.parse(fs.readFileSync(repo.file('test-results/qa-release-' + mode + '.json'), 'utf8'))
    const executed = fs.readFileSync(repo.file('test-results/commands'), 'utf8').trim().split('\n')
    assert.deepEqual(executed, [
      'qa:ci', mode === 'full' ? 'qa' : 'qa:core', 'build:app', 'test:storage-recovery:electron',
      ...(mode === 'full' ? ['qa:dashboard-10k'] : []), 'qa:electron',
    ])
    assert.deepEqual(report.commands, executed)
    assert.equal(report.status, 'pass')
    assert.equal(report.workingTreeDirty, false)
    assert.equal(report.sourceIdentity, 'git-tree:' + report.gitTree)
    assert.match(report.sourceFingerprint, /^[a-f0-9]{64}$/)
  }
})

test('验收开始后修改源码时不会留下本轮或上轮的通过报告', { timeout: 20_000 }, async t => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-release-source-'))
  t.after(() => fs.rmSync(area, { recursive: true, force: true }))
  const repo = checkout(area, 'drift')
  const report = repo.file('test-results/qa-release-smoke.json')
  fs.writeFileSync(report, '{"status":"pass"}')
  const result = await repo.run([], { CHANGE_SOURCE_AT: 'build:app' })
  assert.notEqual(result.code, 0, result.output)
  assert.match(result.output, /source changed|源码.*变化/i)
  assert.equal(fs.existsSync(report), false)
})
