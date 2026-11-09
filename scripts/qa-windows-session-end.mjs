import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright'
import { createDesktopVisualSeedEnvelope } from './fixtures/desktop-visual-seed.mjs'

// Real HWND messages, without ending the user's Windows session or touching their library.
if (process.platform !== 'win32') throw new Error('Windows session-end QA requires Windows')
const root = process.cwd()
const require = createRequire(import.meta.url)
const outputIndex = process.argv.indexOf('--output')
const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : 'test-results/windows-session-end')
const keepOpen = process.argv.includes('--keep-open')
const executableIndex = process.argv.indexOf('--executable')
const executablePath = executableIndex >= 0 ? resolve(process.argv[executableIndex + 1]) : require('electron')
const isolation = mkdtempSync(join(tmpdir(), 'atlas-session-end-'))
const userData = join(isolation, 'user-data')
const library = join(isolation, 'library')
mkdirSync(output, { recursive: true })
mkdirSync(library, { recursive: true })
const envelope = createDesktopVisualSeedEnvelope()
// This test covers shutdown persistence, not the sample's expired trash cleanup.
for (const trade of envelope.snapshot.trades) {
  if (trade.deletedAt) trade.deletedAt = new Date().toISOString()
}
const target = envelope.snapshot.trades[0]
target.note = '<p>隔离测试资料库：Windows 重启退出验证。</p>'
const report = {
  generatedAt: new Date().toISOString(), isolation, userData, library,
  executablePath,
  runtime: executableIndex >= 0 ? 'packaged-windows-electron' : 'built-electron',
  buildSha256: createHash('sha256').update(readFileSync('dist-electron/main.js')).digest('hex'),
  checks: [], nativeMessages: [], launches: [], status: 'running',
}
let application
let page
let processExit
function record(condition, message) {
  assert.ok(condition, message)
  report.checks.push(message)
  console.log(`PASS ${message}`)
}
async function launch() {
  const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE
  const args = [...(executableIndex >= 0 ? [] : ['.']), `--user-data-dir=${userData}`]
  application = await electron.launch({ executablePath, args, cwd: root, env })
  const child = application.process()
  processExit = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.journalBridge))
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1')
  const identity = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { pid: process.pid, electron: process.versions.electron, appPath: app.getAppPath(),
      userData: app.getPath('userData'), build: globalThis.__ATLAS_BUILD_IDENTITY__,
      hwnd: window.getNativeWindowHandle().readBigUInt64LE().toString() }
  })
  assert.equal(identity.userData.toLowerCase(), userData.toLowerCase())
  if (executableIndex >= 0) {
    assert.equal(identity.appPath.toLowerCase(), join(dirname(executablePath), 'resources', 'app.asar').toLowerCase())
  }
  report.launches.push(identity)
  return identity
}
async function send(message) {
  const identity = report.launches.at(-1)
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/helpers/send-windows-session-end.ps1'),
    '-AtlasProcessId', String(identity.pid), '-WindowHandle', identity.hwnd, '-ExpectedUserData', userData, '-Message', message]
  const result = await new Promise((resolveMessage, reject) => {
    const helper = spawn('powershell.exe', args, { windowsHide: true })
    let stdout = '', stderr = ''
    helper.stdout.setEncoding('utf8').on('data', (text) => { stdout += text })
    helper.stderr.setEncoding('utf8').on('data', (text) => { stderr += text })
    helper.on('error', reject)
    helper.on('close', (code) => code === 0 ? resolveMessage(JSON.parse(stdout.trim())) : reject(new Error(stderr)))
  })
  report.nativeMessages.push(result)
  return result
}
async function expectExit(label, timeoutMs = 2000) {
  const exit = await Promise.race([processExit, delay(timeoutMs).then(() => null)])
  record(exit?.code === 0, `${label}: main process exits cleanly within ${timeoutMs} ms`)
  application = null
}
async function loadSnapshot() {
  return page.evaluate(async () => {
    await window.journalBridge.storageOpen()
    const value = await window.journalBridge.loadSnapshot()
    return value?.snapshot ?? value
  })
}
async function assertSavedNote(expected) {
  const snapshot = await loadSnapshot()
  record(snapshot.trades.find((trade) => trade.id === target.id)?.note === expected, 'Restart preserves the saved note in SQLite')
  record(snapshot.trades.length === envelope.snapshot.trades.length, 'Restart preserves the isolated trade count')
}
try {
  await launch()
  const created = await page.evaluate((directory) => window.journalBridge.createNewLibrary(directory), library)
  record(created.ok, 'Created an isolated test library')
  assert.equal((await page.evaluate(() => window.journalBridge.getLibraryPath())).toLowerCase(), library.toLowerCase())
  const imported = await page.evaluate(async (snapshot) => {
    await window.journalBridge.storageOpen()
    await window.journalBridge.loadSnapshot()
    return window.journalBridge.commitImport(snapshot, [], { pruneUnreferenced: true })
  }, envelope.snapshot)
  record(imported, 'Imported the isolated sample using the real storage bridge')
  await page.reload()
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1')
  const cancelled = await send('cancelled')
  record(cancelled.delivered && await application.evaluate(() => true), 'Cancelled WM_ENDSESSION leaves Atlas running')
  await send('confirmed')
  await expectExit('Confirmed WM_ENDSESSION')

  await launch()
  await assertSavedNote(target.note)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await send('confirmed')
  await expectExit('Background/tray WM_ENDSESSION')

  await launch()
  await assertSavedNote(target.note)
  await page.evaluate((ref) => { location.hash = '#/trade/' + ref }, target.ref)
  const editor = page.locator('.dv-editor .ProseMirror')
  await editor.waitFor()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' session-end-pending-note')
  const expectedNote = await editor.innerHTML()
  const query = await send('query')
  record(query.delivered && query.result === 0, 'WM_QUERYENDSESSION delays Windows termination while saving')
  await expectExit('Query-session save and verified backup', 15000)
  await launch()
  await assertSavedNote(expectedNote)
  const log = readFileSync(join(userData, 'logs', 'main.log'), 'utf8')
  record(log.includes('quit:success'), 'The normal quit coordinator completes after native query-session-end')
  record(!/quit:error|uncaught-exception|unhandled-rejection/.test(log), 'No quit or JavaScript lifecycle errors')
  await page.evaluate((ref) => { location.hash = '#/trade/' + ref }, target.ref)
  await page.locator('.dv-editor .ProseMirror').waitFor()
  await page.screenshot({ path: join(output, 'latest-client.png') })
  report.status = 'pass'
} catch (error) {
  report.status = 'fail'
  report.error = error.stack
  if (page && !page.isClosed()) {
    report.lastPage = await page.evaluate(() => ({ route: location.hash,
      uiSettled: document.documentElement.dataset.uiSettled, text: document.body.innerText })).catch(() => null)
    await page.screenshot({ path: join(output, 'failure-client.png') }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (application && (!keepOpen || report.status !== 'pass')) {
    await application.close().catch(() => {})
    application = null
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ status: report.status, output, error: report.error }, null, 2))
}
if (application && keepOpen && report.status === 'pass') await new Promise((resolveClosed) => application.on('close', resolveClosed))
