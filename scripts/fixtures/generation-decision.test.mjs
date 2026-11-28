import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readGitProvenance } from '../git-provenance.mjs'
import { generationRawPassed, generationDecisionPassed } from '../spikes/electron-generation/evidence.mjs'
import { CUTOVER_FAULT_POINTS, MiB } from '../spikes/electron-generation/generation-prototype.mjs'

test('Generation 工作流将两端原始报告交给聚合器', () => {
  const workflow = fs.readFileSync('.github/workflows/generation-spike.yml', 'utf8')
  assert.match(workflow, /path: test-results\/collected-generation-evidence/)
  assert.match(workflow, /--evidence-root test-results\/collected-generation-evidence --require-complete/)
  assert.doesNotThrow(() => execFileSync('git', [
    'check-ignore',
    '-q',
    'test-results/collected-generation-evidence/probe.json',
  ]))
})

function sampleGeneration() {
  const expectedFaults = [
    ...CUTOVER_FAULT_POINTS,
    'disk-full-initial', 'disk-full-switch', 'target-occupied', 'cross-volume-exdev',
  ]
  return {
    version: 1,
    platform: 'darwin', fileSystem: 'APFS', decision: 'NO_GO_ON_THIS_PLATFORM', workingTreeDirty: false,
    recoverySloMs: 5_000,
    faultMatrix: expectedFaults.map((name) => ({
      name, expectedFailure: true, observedFailure: true, neverMixed: true, pass: true, recoveryMs: 1,
    })),
    recoveryCases: [
      ['marker-missing', 'old'],
      ['marker-corrupt', 'old'],
      ['incomplete-generation', 'old'],
      ['incomplete-old-generation', 'new'],
    ].map(([name, recovered]) => ({ name, recovered, pass: true, recoveryMs: 1 })),
    disk: {
      formula: 'requiredFree = expandedTemp + rollbackCopy + max(512 MiB, operationBytes * 10%)',
      expandedTemp: 20, rollbackCopy: 10, operationBytes: 20,
      safetyReserve: 512 * MiB, requiredFree: 30 + 512 * MiB,
      predictedAdditionalPeakBytes: 30, peakErrorRatio: 0.01, peakTargetPass: true,
    },
    durability: { fileFsyncExercised: true, directoryFsyncSupported: false },
    reasons: ['directory fsync durability barrier unavailable'],
    isolation: 'scripts/spikes/electron-generation only; no production import',
  }
}

test('Generation 原始报告核对故障、恢复、磁盘与耐久性，最终决策沿用 No-Go', () => {
  const generation = sampleGeneration()
  assert.equal(generationRawPassed(generation, 'darwin', 'APFS'), true)
  assert.equal(generationRawPassed({ ...generation, faultMatrix: [{ pass: false, recoveryMs: 1 }] }, 'darwin', 'APFS'), false)
  assert.equal(generationRawPassed({
    ...generation,
    decision: 'GO_ELIGIBLE_ON_THIS_PLATFORM',
    durability: { fileFsyncExercised: true, directoryFsyncSupported: true },
    reasons: [],
  }, 'darwin', 'APFS'), true)
  const decision = {
    version: 1, status: 'pass', decision: 'NO_GO', workingTreeDirty: false, failures: [],
    platforms: {
      windows: { decision: 'NO_GO_ON_THIS_PLATFORM' },
      macos: { decision: 'GO_ELIGIBLE_ON_THIS_PLATFORM' },
    },
    adr: 'generation-layout-no-go',
  }
  assert.equal(generationDecisionPassed(decision), true)
  assert.equal(generationDecisionPassed({ ...decision, platforms: { windows: decision.platforms.windows, macos: null } }), false)
})

test('Generation 复验区分两平台的唯一报告，损坏与重复输入会替换先前的通过结果', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-generation-decision-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const evidence = path.join(root, 'test-results', 'collected')
  fs.mkdirSync(path.join(evidence, 'archive'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'test-results/\n')
  const git = (...args) => execFileSync('git', args, { cwd: root })
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'fixture')

  const mac = { ...sampleGeneration(), ...await readGitProvenance(root) }
  const windows = { ...mac, platform: 'win32', fileSystem: 'NTFS' }
  const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value))
  const macFile = 'archive/renamed-macos.json'
  const winFile = 'generation-spike-windows-ntfs.json'
  const verify = (expected, reason, dir = evidence) => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../verify-generation-decision.mjs', import.meta.url)),
      '--evidence-root', dir, '--require-complete',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, expected === 'pass' ? 0 : 1, result.stderr + result.stdout)
    const report = JSON.parse(fs.readFileSync(path.join(root, 'test-results/generation-spike/generation-decision.json'), 'utf8'))
    assert.equal(report.status, expected)
    assert.equal(report.decision, 'NO_GO')
    assert.equal(generationDecisionPassed(report), expected === 'pass')
    if (reason) assert.match(report.failures.join('\n'), reason)
    return report
  }
  write(macFile, mac)
  write(winFile, windows)
  assert.match(verify('pass').platforms.macos.file, /archive\/renamed-macos\.json$/)
  write('second.json', { ...mac, decision: 'incomplete' })
  verify('hold', /macOS APFS.*ambiguous reports: 2/)
  fs.unlinkSync(path.join(evidence, 'second.json'))
  write(macFile, { ...mac, recoveryCases: undefined })
  verify('hold', /macOS APFS.*contract invalid/)
  write(macFile, { ...mac, sourceIdentity: 'old-source' })
  verify('hold', /source identity mismatch/)
  write(macFile, mac)
  write(winFile, mac)
  verify('hold', /Windows NTFS.*contract invalid/)
  fs.writeFileSync(path.join(evidence, winFile), '{')
  verify('hold', /Windows NTFS.*invalid JSON/)
  write(winFile, {
    ...windows, decision: 'GO_ELIGIBLE_ON_THIS_PLATFORM',
    durability: { fileFsyncExercised: true, directoryFsyncSupported: true }, reasons: [],
  })
  verify('hold', /platform decisions differ/)
  write(winFile, { ...windows, durability: { fileFsyncExercised: true }, reasons: [] })
  verify('hold', /contract invalid/)
  write(winFile, null)
  verify('hold', /expected a JSON object/)
  write(winFile, windows)
  verify('pass')
  verify('hold', /cannot enumerate evidence directory/, path.join(evidence, winFile))
  verify('hold', /missing report/, path.join(evidence, 'absent'))
})
