import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('附件生命周期平台门运行真实 Electron 测试并输出可追溯报告', () => {
  const runner = fs.readFileSync('scripts/run-asset-lifecycle-platform.mjs', 'utf8')
  assert.match(runner, /electron\/library\/assetGc\.test\.ts/)
  assert.match(runner, /electron\/library\/assetInventory\.test\.ts/)
  assert.match(runner, /gitTree/)
  assert.match(runner, /sourceFingerprint/)
  assert.match(runner, /sourceIdentity/)
  assert.match(runner, /asset-lifecycle-/)
})
