import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CUTOVER_FAULT_POINTS,
  MiB,
  commitGeneration,
  diskBudget,
  generationPayload,
  initializePrototype,
  recoverGeneration,
} from '../spikes/electron-generation/generation-prototype.mjs'

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'generation-contract-'))
}

test('Generation 磁盘公式精确保留 Spec v2 的 512 MiB 安全余量', () => {
  assert.deepEqual(diskBudget({ expandedTemp: 10, rollbackCopy: 20, operationBytes: 100 }), {
    expandedTemp: 10,
    rollbackCopy: 20,
    operationBytes: 100,
    safetyReserve: 512 * MiB,
    requiredFree: 512 * MiB + 30,
  })
})

test('每个切换故障点恢复后只会选择完整旧代或完整新代', () => {
  for (const point of CUTOVER_FAULT_POINTS) {
    const root = temporaryRoot()
    try {
      initializePrototype(root, generationPayload('generation-000', 'old', 4096, 4096))
      const result = commitGeneration(root, generationPayload('generation-001', 'new', 4096, 4096), { injectAt: point })
      assert.equal(result.ok, false, `${point} 必须真实触发失败`)
      assert.match(recoverGeneration(root).label, /^(old|new)$/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('marker 缺失、损坏或指向不完整代时回退到已验证旧代', () => {
  for (const mode of ['missing', 'corrupt', 'incomplete']) {
    const root = temporaryRoot()
    try {
      initializePrototype(root, generationPayload('generation-000', 'old', 4096, 4096))
      if (mode === 'missing') fs.rmSync(path.join(root, 'CURRENT'))
      if (mode === 'corrupt') fs.writeFileSync(path.join(root, 'CURRENT'), 'bad-json')
      if (mode === 'incomplete') {
        fs.mkdirSync(path.join(root, 'generations', 'generation-001'))
        fs.writeFileSync(path.join(root, 'CURRENT'), JSON.stringify({ generation: 'generation-001' }))
      }
      assert.equal(recoverGeneration(root).label, 'old')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('当前新代完整时，即使旧代不完整也只选择完整新代', () => {
  const root = temporaryRoot()
  try {
    initializePrototype(root, generationPayload('generation-000', 'old', 4096, 4096))
    const committed = commitGeneration(root, generationPayload('generation-001', 'new', 4096, 4096))
    assert.equal(committed.ok, true)
    fs.rmSync(path.join(root, 'generations', 'generation-000', 'journal.db'))
    assert.equal(recoverGeneration(root).label, 'new')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Spike 路径没有进入生产源码或 Electron bundle 入口', () => {
  for (const directory of ['src', 'electron']) {
    const pending = [directory]
    while (pending.length > 0) {
      const current = pending.pop()
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) pending.push(entryPath)
        else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
          assert.doesNotMatch(fs.readFileSync(entryPath, 'utf8'), /spikes\/electron-generation/)
        }
      }
    }
  }
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.deepEqual(pkg.build.files, ['dist/**/*', 'dist-electron/**/*'])
  assert.equal(pkg.build.files.some((pattern) => pattern.includes('scripts')), false)
})

test('Spike 原始报告携带跨平台稳定的源码身份', () => {
  const runner = fs.readFileSync('scripts/spikes/electron-generation/run-generation-spike.mjs', 'utf8')
  assert.match(runner, /gitTree: provenance\.gitTree/)
  assert.match(runner, /sourceIdentity: provenance\.sourceIdentity/)
})
