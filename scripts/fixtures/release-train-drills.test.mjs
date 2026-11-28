import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { readGitProvenance } from '../git-provenance.mjs'
import { resetExecutionReport, writeExecutionReport } from '../quality-execution.mjs'

import { evaluateReleaseTrainDrills, releaseTrainDrillsPassed, requiredDrillScenarioIds, RELEASE_TRAIN_DRILLS } from '../release-train-drills.mjs'

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
  const allIds = [...requiredDrillScenarioIds()]
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

test('重新执行同一文件的其他用例后，旧合同不能为缺席的演练场景签发通过', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-drill-evidence-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = 'scripts/scenarios.test.mjs'
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, file), '// two or more tests in this file')
  fs.writeFileSync(path.join(root, '.gitignore'), 'test-results/\n')
  const ids = [...requiredDrillScenarioIds()]
  const scenarios = ids.map(id => ({ id, testId: file + '#' + id, evidence: [file] }))
  fs.writeFileSync(path.join(root, 'scripts/quality-scenarios.json'), JSON.stringify(scenarios))
  const git = (...args) => execFileSync('git', args, { cwd: root })
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'fixture')
  const source = await readGitProvenance(root)
  const writeTests = tests => writeExecutionReport(root, source, [file], tests.map(s => s.testId))
  await writeTests(scenarios)
  const results = path.join(root, 'test-results')
  fs.writeFileSync(path.join(results, 'quality-contract.json'), JSON.stringify({
    ...source, status: 'pass', executionRequired: true, executedContractScenarioIds: ids,
  }))
  const verify = code => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../run-release-train-drills.mjs', import.meta.url)), '--require-complete',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, code, result.stderr || result.stdout)
    const report = JSON.parse(fs.readFileSync(path.join(results, 'release-trains/release-train-drills.json'), 'utf8'))
    assert.equal(releaseTrainDrillsPassed(report), code === 0)
    return report
  }
  const complete = verify(0)
  assert.equal(complete.status, 'pass')
  const train = complete.trains[1]
  const recoveryPhase = train.phases.userRecovery
  recoveryPhase.scenarioIds = ['W-NO-LOCKS']
  assert.equal(releaseTrainDrillsPassed(complete), false)
  recoveryPhase.scenarioIds = ['W-RECOVERY-EXPORT']
  recoveryPhase.missingScenarioIds = [...recoveryPhase.scenarioIds]
  assert.equal(releaseTrainDrillsPassed(complete), false)
  recoveryPhase.missingScenarioIds = []
  complete.trains[1] = complete.trains[0]
  assert.equal(releaseTrainDrillsPassed(complete), false)
  const missing = 'W-RECOVERY-EXPORT'
  await resetExecutionReport(root)
  await writeTests(scenarios.filter(s => s.id !== missing))
  const incomplete = verify(1)
  assert.equal(incomplete.status, 'hold')
  const recovery = incomplete.trains.find(train => train.id === 'release-1').phases.userRecovery
  assert.deepEqual(recovery.missingScenarioIds, [missing])
  assert.equal(recovery.status, 'hold')
  await writeTests(scenarios.filter(s => s.id === missing))
  assert.equal(verify(0).status, 'pass')
  const previous = JSON.parse(fs.readFileSync(path.join(results, 'quality-contract.json'), 'utf8'))
  fs.writeFileSync(path.join(results, 'quality-contract.json'), JSON.stringify({ ...previous, sourceIdentity: 'from-another-source' }))
  assert.ok(verify(1).trains.every(train => train.status === 'hold'))
})

// Quality-Scenario: R-TRAIN-DRILLS
