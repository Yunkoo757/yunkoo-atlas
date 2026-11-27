import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runHeadlessElectron } from '../headless-electron.mjs'

test('无窗口 QA 使用一次性用户目录，空回执或缺少 SQLite 实物均不能通过', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-headless-fixture-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of ['scripts', 'dist-electron', 'node_modules/electron']) fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist-electron/main.js'), '')
  fs.copyFileSync(new URL('../qa-electron.mjs', import.meta.url), path.join(root, 'scripts/qa-electron.mjs'))
  fs.writeFileSync(path.join(root, 'scripts/headless-electron.mjs'),
    'export { runHeadlessElectron } from ' + JSON.stringify(new URL('../headless-electron.mjs', import.meta.url).href))
  fs.writeFileSync(path.join(root, 'scripts/bundle-build-identity.mjs'),
    'export { removeTemporaryDirectoryBounded } from ' + JSON.stringify(new URL('../bundle-build-identity.mjs', import.meta.url).href))
  fs.writeFileSync(path.join(root, 'node_modules/electron/index.js'), 'module.exports = process.execPath')
  fs.symlinkSync(fileURLToPath(new URL('../../node_modules/sql.js', import.meta.url)), path.join(root, 'node_modules/sql.js'), 'junction')
  fs.writeFileSync(path.join(root, 'index.js'), [
    "const fs = require('node:fs')",
    "const checks = process.env.EMPTY_CHECKS ? [] : [{ name: 'fixture', pass: true }]",
    "const library = process.env.TRADER_ATLAS_LIBRARY",
    "const userData = process.argv.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)",
    "fs.writeFileSync('launched.json', JSON.stringify({userData, library, asNode:process.env.ELECTRON_RUN_AS_NODE}))",
    "fs.writeFileSync(process.env.TRADER_ATLAS_QA_RESULT, JSON.stringify({checks, libraryPath:library, total:checks.length, passed:checks.length}))",
  ].join('\n'))
  const profiles = new Set()
  for (const empty of [true, false]) {
    const result = spawnSync(process.execPath, ['scripts/qa-electron.mjs'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EMPTY_CHECKS: empty ? '1' : '' },
    })
    const launch = JSON.parse(fs.readFileSync(path.join(root, 'launched.json'), 'utf8'))
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, empty ? /检查结果/ : /journal\.db/)
    assert.ok(path.isAbsolute(launch.userData))
    assert.notEqual(launch.userData, launch.library)
    assert.equal(launch.asNode, undefined)
    assert.equal(fs.existsSync(launch.userData), false)
    assert.equal(fs.existsSync(launch.library), false)
    profiles.add(launch.userData)
  }
  assert.equal(profiles.size, 2)
})

test('子进程超时后先终止进程，再释放它的用户目录', { timeout: 8000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-headless-timeout-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'index.js'), [
    "const fs = require('node:fs')",
    "fs.writeFileSync('profile', process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))",
    'setInterval(() => {}, 100)',
  ].join('\n'))
  let child
  await assert.rejects(runHeadlessElectron({
    executable: process.execPath, root, library: path.join(root, 'isolated-library'), timeoutMs: 1500,
    onSpawn(process) { child = process },
  }), /未退出/)
  assert.ok(child.exitCode !== null || child.signalCode !== null)
  assert.equal(fs.existsSync(fs.readFileSync(path.join(root, 'profile'), 'utf8')), false)
})
