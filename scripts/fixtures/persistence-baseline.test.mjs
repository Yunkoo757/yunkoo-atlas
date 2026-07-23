import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PERSISTENCE_BASELINE_METRICS,
  findRelativeRegressions,
  validateApprovedPersistenceBaseline,
  validatePersistenceMetrics,
} from '../persistence-baseline.mjs'
import { readGitProvenance, selectSourceIdentity } from '../git-provenance.mjs'

test('批准基线只在超过 20% 时判定退化', () => {
  const baseline = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 100]))
  assert.equal(findRelativeRegressions(baseline, { ...baseline, web10kSaveP95Ms: 120 }).length, 0)
  assert.deepEqual(
    findRelativeRegressions(baseline, { ...baseline, web10kSaveP95Ms: 120.01 }).map((item) => item.metric),
    ['web10kSaveP95Ms'],
  )
})

test('零基线只允许当前值继续为零', () => {
  const baseline = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 100]))
  baseline.web10kMaxLongTaskMs = 0
  assert.equal(findRelativeRegressions(baseline, { ...baseline }).length, 0)
  assert.deepEqual(
    findRelativeRegressions(baseline, { ...baseline, web10kMaxLongTaskMs: 1 }).map((item) => item.reason),
    ['zero-baseline'],
  )
})

test('基线指标集合和数值严格 fail-closed', () => {
  const metrics = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 100]))
  assert.equal(validatePersistenceMetrics(metrics), metrics)
  assert.throws(() => validatePersistenceMetrics({ ...metrics, extra: 1 }), /指标集合不匹配/)
  const { web10kSaveP95Ms: _missing, ...missing } = metrics
  assert.throws(() => validatePersistenceMetrics(missing), /missing=web10kSaveP95Ms/)
  assert.throws(() => validatePersistenceMetrics({ ...metrics, web10kSaveP95Ms: Number.NaN }), /有限非负数/)
  assert.throws(() => validatePersistenceMetrics({ ...metrics, web10kSaveP95Ms: -1 }), /有限非负数/)
})

test('批准基线严格校验版本、批准信息与完整指标', () => {
  const metrics = Object.fromEntries(PERSISTENCE_BASELINE_METRICS.map((metric) => [metric, 100]))
  const valid = { version: 1, approvedBy: 'Yunkoo', approvedAt: '2026-07-23T00:00:00.000Z', metrics }
  assert.equal(validateApprovedPersistenceBaseline(valid), valid)
  assert.throws(() => validateApprovedPersistenceBaseline({ ...valid, version: 2 }), /版本必须严格为 1/)
  assert.throws(() => validateApprovedPersistenceBaseline({ ...valid, approvedBy: '' }), /缺少批准人/)
  assert.throws(() => validateApprovedPersistenceBaseline({ ...valid, approvedAt: 'invalid' }), /有效批准时间/)
})

test('Git 来源在干净工作树使用 tree，在脏工作树使用内容指纹', async () => {
  const gitTree = 'a'.repeat(40)
  assert.equal(
    selectSourceIdentity({ workingTreeDirty: false, gitTree, sourceFingerprint: 'b'.repeat(64) }),
    `git-tree:${gitTree}`,
  )
  assert.equal(
    selectSourceIdentity({ workingTreeDirty: false, gitTree, sourceFingerprint: 'c'.repeat(64) }),
    `git-tree:${gitTree}`,
  )
  assert.notEqual(
    selectSourceIdentity({ workingTreeDirty: true, gitTree, sourceFingerprint: 'b'.repeat(64) }),
    selectSourceIdentity({ workingTreeDirty: true, gitTree, sourceFingerprint: 'c'.repeat(64) }),
  )

  const first = await readGitProvenance()
  const second = await readGitProvenance()
  assert.match(first.gitCommit, /^[0-9a-f]{40}$/)
  assert.match(first.gitTree, /^[0-9a-f]{40}$/)
  assert.match(first.sourceFingerprint, /^[0-9a-f]{64}$/)
  assert.equal(first.sourceFingerprint, second.sourceFingerprint)
  assert.equal(typeof first.workingTreeDirty, 'boolean')
  assert.equal(
    first.sourceIdentity,
    selectSourceIdentity(first),
  )
})
