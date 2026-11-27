import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('Node 质量证据只登记实际执行的测试，失败或跳过后移除旧报告', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-node-evidence-'))
  const runner = fileURLToPath(new URL('../run-quality-node-tests.mjs', import.meta.url))
  const report = path.join(root, 'test-results', 'quality-execution.json')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const execute = () => spawnSync(process.execPath, [runner], { cwd: root, env, encoding: 'utf8' })
  const fixture = 'scripts/fixtures/evidence.test.mjs'
  try {
    fs.mkdirSync(path.join(root, 'scripts', 'fixtures'), { recursive: true })
    fs.writeFileSync(path.join(root, '.gitignore'), 'test-results/\n')
    for (const name of ['release-command', 'release-artifacts', 'test-discovery']) {
      fs.writeFileSync(path.join(root, 'scripts', name + '.test.mjs'), "import test from 'node:test'; test('entry', () => {})")
    }
    fs.writeFileSync(path.join(root, fixture), [
      "import test from 'node:test'",
      "if (false) test('never executed', () => {})",
      "for (const name of ['first', 'second']) test(name, () => {})",
    ].join('\n'))
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root })
    const result = execute()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const evidence = JSON.parse(fs.readFileSync(report, 'utf8'))
    assert.deepEqual(Object.keys(evidence.executedTests).filter(id => id.startsWith(fixture)), [
      fixture + '#first', fixture + '#second',
    ])
    for (const scenario of ["test.skip('omitted', () => {})", "test.todo('later')", "test('broken', () => { throw Error() })"]) {
      fs.writeFileSync(path.join(root, fixture), "import test from 'node:test'\n" + scenario)
      const failed = execute()
      assert.notEqual(failed.status, 0)
      assert.equal(fs.existsSync(report), false)
    }
    fs.writeFileSync(path.join(root, 'value.mjs'), 'export const value = 1')
    fs.writeFileSync(path.join(root, fixture), [
      "import test from 'node:test'",
      "import { value } from '../../value.mjs'",
      "import { writeFileSync } from 'node:fs'",
      "test('compiled dependency', () => { if (value !== 1) throw Error(); writeFileSync('value.mjs', 'export const value = 2') })",
    ].join('\n'))
    const changed = execute()
    assert.notEqual(changed.status, 0, '执行期间源码变化，不能登记为新源码的 PASS')
    assert.match(changed.stderr, /source changed|源码.*变化/i)
    assert.equal(fs.existsSync(report), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
