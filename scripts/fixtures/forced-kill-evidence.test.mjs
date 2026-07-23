import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('E-FORCED-KILL 使用真实 Electron 主进程、原子临时文件观察和强杀后重开', () => {
  const runner = fs.readFileSync('scripts/run-forced-kill-evidence.mjs', 'utf8')
  const main = fs.readFileSync('electron/main.ts', 'utf8')
  const qa = fs.readFileSync('electron/forcedKillQa.ts', 'utf8')
  const workflow = fs.readFileSync('.github/workflows/forced-kill-evidence.yml', 'utf8')
  assert.match(runner, /createRequire\(import\.meta\.url\)/)
  assert.match(runner, /spawn\(electronExecutable, \['\.'\]/)
  assert.match(runner, /delete env\.ELECTRON_RUN_AS_NODE/)
  assert.match(runner, /LINEAR_JOURNAL_FORCED_KILL_MODE: mode/)
  assert.match(runner, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'atlas-forced-kill-library-'\)\)/)
  assert.match(runner, /fs\.watch\(libraryRoot/)
  assert.match(runner, /\.journal\.db\./)
  assert.match(runner, /child\.kill\('SIGKILL'\)/)
  assert.match(runner, /killSignalSent = child\.kill\('SIGKILL'\)/)
  assert.match(runner, /crash\.signal !== 'SIGKILL'/)
  assert.match(runner, /runElectronMain\('verify'\)/)
  assert.match(runner, /gitTree: provenance\.gitTree/)
  assert.match(runner, /sourceIdentity: provenance\.sourceIdentity/)
  assert.match(runner, /unconfirmedMemoryEditPromised: false/)
  assert.match(main, /runElectronForcedKillMode\(forcedKillMode, libraryRoot\)/)
  assert.match(qa, /runtime: 'electron-main'/)
  assert.match(qa, /confirmed-revision-1/)
  assert.match(qa, /unconfirmed-revision-2/)
  assert.match(qa, /128 \* 1024 \* 1024/)
  assert.match(workflow, /electron\/main\.ts/)
  assert.match(workflow, /electron\/forcedKillQa\.ts/)
  assert.doesNotMatch(workflow, /forcedKillChild/)
  assert.match(workflow, /pnpm exec install-electron/)
  assert.ok(
    workflow.indexOf('pnpm build:app') < workflow.indexOf('pnpm test:forced-kill:electron'),
    '双平台专用 workflow 必须先构建生产 Electron 主进程再执行强杀',
  )
})

// Quality-Scenario: E-FORCED-KILL
