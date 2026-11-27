import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

import { parseDfDevice, parseDiskutilFileSystem } from '../file-system-type.mjs'

function platformFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-platform-report-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const put = (name, source) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }
  put('.gitignore', 'test-results/\n')
  put('vite.config.ts', 'export default {}')
  put('scripts/run-regression-tests.mjs', 'await import(' + JSON.stringify(new URL('../run-regression-tests.mjs', import.meta.url).href) + ')')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=QA', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root })
  return {
    put,
    run(name) {
      const report = path.join(root, 'test-results', 'report.json')
      const runner = fileURLToPath(new URL('../run-' + name + '-platform.mjs', import.meta.url))
      const result = spawnSync(process.execPath, [runner, '--output', report], { cwd: root, encoding: 'utf8' })
      if (result.error) throw result.error
      return { ...result, report: JSON.parse(fs.readFileSync(report, 'utf8')) }
    },
  }
}

test('平台安全报告只登记实际通过的指定测试', t => {
  const fixture = platformFixture(t)
  const entry = 'electron/platformSafety.test.ts'
  const first = 'testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary'
  const second = 'testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable'
  fixture.put(entry, `export function ${first}() {}\nexport function ${second}() {}`)
  const passed = fixture.run('electron-safety')
  assert.equal(passed.status, 0, passed.stderr)
  assert.deepEqual(passed.report.scenarios.map(item => item.testId), [entry + '#' + first, entry + '#' + second])
  fixture.put(entry, `export function ${first}WithSuffix() { console.log('PASS ${entry} :: ${first}') }\nexport function ${second}() {}`)
  const omitted = fixture.run('electron-safety')
  assert.notEqual(omitted.status, 0)
  assert.equal(omitted.report.status, 'fail')
  assert.deepEqual(omitted.report.scenarios.map(item => item.pass), [false, true])
})

test('附件平台门验证两个入口均实际完成，执行期间源码变化也会使本轮失败', t => {
  const fixture = platformFixture(t)
  const gc = 'electron/library/assetGc.test.ts'
  const inventory = 'electron/library/assetInventory.test.ts'
  fixture.put(gc, 'export function testGc() {}')
  fixture.put(inventory, 'export function testInventory() {}')
  const passed = fixture.run('asset-lifecycle')
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(passed.report.status, 'pass')
  assert.deepEqual(passed.report.entries, [gc, inventory])
  assert.ok(passed.report.gitTree && passed.report.sourceFingerprint && passed.report.sourceIdentity)
  fixture.put(gc, 'export function testGc() { process.exit(0) }')
  const incomplete = fixture.run('asset-lifecycle')
  assert.notEqual(incomplete.status, 0)
  assert.equal(incomplete.report.status, 'fail')
  fixture.put(gc, "import { writeFileSync } from 'node:fs'; export function testGc() { writeFileSync('source.ts', 'changed') }")
  const changed = fixture.run('asset-lifecycle')
  assert.notEqual(changed.status, 0)
  assert.equal(changed.report.status, 'fail')
})

test('macOS 文件系统类型从 diskutil plist 读取并拒绝路径字符', () => {
  assert.equal(parseDiskutilFileSystem(`
    <plist><dict>
      <key>FilesystemName</key><string>APFS</string>
      <key>FilesystemType</key><string>apfs</string>
    </dict></plist>
  `), 'APFS')
  assert.throws(() => parseDiskutilFileSystem(`
    <plist><dict><key>FilesystemName</key><string>/</string></dict></plist>
  `), /无法识别安全的文件系统类型/)
  assert.throws(() => parseDiskutilFileSystem('<plist><dict></dict></plist>'), /缺少/)
  assert.equal(parseDfDevice(`
Filesystem 512-blocks Used Available Capacity Mounted on
/dev/disk3s5 1000 100 900 10% /System/Volumes/Data
  `), '/dev/disk3s5')
  assert.throws(() => parseDfDevice('Filesystem Mounted on\n/  /'), /不安全的设备名/)
})
