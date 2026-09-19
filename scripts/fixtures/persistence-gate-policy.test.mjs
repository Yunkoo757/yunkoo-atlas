import test from 'node:test'
import assert from 'node:assert/strict'
import { checkPersistenceTiming } from '../persistence-gate-policy.mjs'

test('正确性模式保留性能告警，严格模式仍阻止慢测量', () => {
  for (const correctnessOnly of [true, false]) {
    const failures = ['existing correctness failure']
    const warnings = []
    checkPersistenceTiming('save', 3619, 3000, failures, warnings, correctnessOnly)
    assert.equal(failures[0], 'existing correctness failure')
    assert.equal(failures.length, correctnessOnly ? 1 : 2)
    assert.equal(warnings.length, correctnessOnly ? 1 : 0)
    checkPersistenceTiming('save', 2000, 3000, failures, warnings, correctnessOnly)
    assert.equal(failures.length + warnings.length, 2)
  }
})

test('缺失或无效测量在两种模式中都必须失败', () => {
  for (const correctnessOnly of [true, false]) {
    for (const actual of [NaN, Infinity, undefined]) {
      const failures = []
      const warnings = []
      checkPersistenceTiming('save', actual, 3000, failures, warnings, correctnessOnly)
      assert.deepEqual(failures, ['save: invalid measurement'])
      assert.deepEqual(warnings, [])
    }
  }
})
