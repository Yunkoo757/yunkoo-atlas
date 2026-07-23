import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

test('Generation 聚合门要求 NTFS、APFS、磁盘误差、隔离和无条件 No-Go ADR', () => {
  const source = fs.readFileSync('scripts/verify-generation-decision.mjs', 'utf8')
  const workflow = fs.readFileSync('.github/workflows/generation-spike.yml', 'utf8')
  assert.match(source, /value\.platform === 'win32' && value\.fileSystem === 'NTFS'/)
  assert.match(source, /value\.platform === 'darwin' && value\.fileSystem === 'APFS'/)
  assert.match(source, /git tree mismatch/)
  assert.match(source, /source identity mismatch/)
  assert.match(source, /report was produced from a dirty working tree/)
  assert.match(source, /current release working tree is dirty/)
  assert.match(source, /disk\.peakErrorRatio/)
  assert.match(source, /item\.recoveryMs < 5_000/)
  assert.match(source, /no production import/)
  assert.match(source, /状态：No-Go/)
  assert.match(source, /decision: 'NO_GO'/)
  assert.match(workflow, /path: test-results\/collected-generation-evidence/)
  assert.match(workflow, /--evidence-root test-results\/collected-generation-evidence --require-complete/)
  assert.doesNotThrow(() => execFileSync('git', [
    'check-ignore',
    '-q',
    'test-results/collected-generation-evidence/probe.json',
  ]))
})
