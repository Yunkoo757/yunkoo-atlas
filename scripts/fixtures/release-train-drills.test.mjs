import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { evaluateReleaseTrainDrills, RELEASE_TRAIN_DRILLS } from '../release-train-drills.mjs'

test('四个 Release Train 都具备 stop、rollback、userRecovery 可执行证据', () => {
  const scenarios = JSON.parse(fs.readFileSync('scripts/quality-scenarios.json', 'utf8'))
  const automaticIds = scenarios
    .filter((scenario) => scenario.mode !== 'manual' && scenario.mode !== 'release-gate')
    .map((scenario) => scenario.id)
  const result = evaluateReleaseTrainDrills(automaticIds)

  assert.deepEqual(RELEASE_TRAIN_DRILLS.map((train) => train.id), [
    'release-0', 'release-1', 'release-2', 'release-3',
  ])
  for (const train of result) {
    assert.equal(train.status, 'pass', `${train.id} 的完整演练必须通过`)
    assert.deepEqual(Object.keys(train.phases), ['stop', 'rollback', 'userRecovery'])
  }
})

test('任一阶段缺少已执行场景时对应 Train 必须 HOLD', () => {
  const allIds = RELEASE_TRAIN_DRILLS.flatMap((train) => (
    Object.values(train).flatMap((value) => value?.scenarioIds ?? [])
  ))
  const result = evaluateReleaseTrainDrills(allIds.filter((id) => id !== 'W-RECOVERY-EXPORT'))
  const release1 = result.find((train) => train.id === 'release-1')
  assert.equal(release1?.phases.userRecovery.status, 'hold')
  assert.deepEqual(release1?.phases.userRecovery.missingScenarioIds, ['W-RECOVERY-EXPORT'])
  assert.equal(release1?.status, 'hold')
})

test('演练门将质量报告绑定到当前源码身份', () => {
  const runner = fs.readFileSync('scripts/run-release-train-drills.mjs', 'utf8')
  assert.match(runner, /\['quality contract', qualityContract\]/)
  assert.match(runner, /\['quality execution', qualityExecution\]/)
  assert.match(runner, /`\$\{name\} source identity mismatch`/)
  assert.match(runner, /evidence\?\.gitTree !== provenance\.gitTree/)
})

// Quality-Scenario: R-TRAIN-DRILLS
