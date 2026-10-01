import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'
import JSZip from 'jszip'
import { createBacktestReviewSnapshot } from './fixtures/backtest-review-seed.mjs'
import { readGitProvenance } from './git-provenance.mjs'

// Local exploratory evidence, not the clean-commit release certification.
// Never attach to a running client. Both paths are exclusively owned by this run.
const root = resolve('.')
const require = createRequire(import.meta.url)
const runtime = await mkdtemp(join(tmpdir(), 'atlas-backtest-perf-safety-'))
const userData = join(runtime, 'user-data')
const library = join(runtime, 'library')
const safetyOnly = process.argv.includes('--safety-only')
const output = resolve('test-results/backtest-performance-safety', safetyOnly ? 'safety.json' : process.argv.includes('--after') ? 'after.json' : 'before.json')
await mkdir(resolve('test-results/backtest-performance-safety'), { recursive: true })
await rm(output, { force: true })
const report = { runtime, userData, library, generatedAt: new Date().toISOString(), platform: process.platform, provenance: await readGitProvenance(root), performance: [], safety: {}, errors: [] }
const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '', TRADER_ATLAS_STORAGE_RECOVERY_QA: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const domainHash = snapshot => hash({ projects: snapshot.backtestProjects, trades: snapshot.trades })
const timings = values => { const sorted = [...values].sort((a, b) => a - b); return { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) } }
const ready = async () => {
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1' && !!document.querySelector('.sidebar'))
}
const settled = async () => {
  await page.waitForTimeout(1200)
  await page.waitForFunction(() => !document.querySelector('.save-status.is-dirty, .save-status.is-saving, .save-status-recovery'))
}
const launch = async () => {
  const start = performance.now()
  app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: root, env, timeout: 60000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => report.errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.hide() })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(userData))
  await page.waitForFunction(() => !!window.journalBridge)
  report.identities = { renderer: await page.evaluate(() => window.__ATLAS_BUILD_IDENTITY__), main: await app.evaluate(() => global.__ATLAS_BUILD_IDENTITY__) }
  return performance.now() - start
}
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
const navigate = async (route, selector) => {
  const start = performance.now()
  await page.evaluate(route => { location.hash = route }, route)
  await page.locator(selector).first().waitFor()
  await frame()
  return performance.now() - start
}
const stopWithoutRendererFlush = async () => {
  const child = app.process()
  const exited = new Promise(done => child.once('exit', done))
  await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 20) }).catch(() => {})
  await exited
  app = undefined
}
const restartFromDurable = async () => { await stopWithoutRendererFlush(); await launch(); await ready() }
const fixture = (count, projects) => {
  const snapshot = createBacktestReviewSnapshot()
  const original = snapshot.trades
  snapshot.backtestProjects = Array.from({ length: projects }, (_, i) => ({ ...snapshot.backtestProjects[0], id: `perf-${i}`, name: `隔离性能样例 ${i + 1}`, targetCount: count / projects }))
  snapshot.trades = Array.from({ length: count }, (_, i) => ({ ...original[i % 100], session: 'London', id: `perf-trade-${i}`, ref: `TRD-${i + 1}`, backtestProjectId: `perf-${Math.floor(i / (count / projects))}` }))
  snapshot.starredIds = []
  return snapshot
}
const asset = { id: 'backtest-demo-chart', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==' }
try {
  await launch()
  assert.equal((await page.evaluate(path => window.journalBridge.createNewLibrary(path), library)).ok, true)
  assert.equal(resolve(await page.evaluate(() => window.journalBridge.getLibraryPath())), resolve(library))
  await page.evaluate(async () => { await window.journalBridge.storageOpen(); await window.journalBridge.loadSnapshot() })
  for (const [count, projects] of safetyOnly ? [[10000, 100]] : [[100, 1], [1000, 1], [10000, 1], [10000, 100]]) {
    const snapshot = fixture(count, projects)
    await settled()
    const importStart = performance.now()
    assert.equal(await page.evaluate(({ snapshot, asset }) => window.journalBridge.commitImport(snapshot, [asset], { pruneUnreferenced: true }), { snapshot, asset }), true)
    const importMs = performance.now() - importStart
    // Direct IPC fixtures do not hydrate the renderer store. Restart before any
    // unload/visibility flush can write that deliberately stale store back.
    await restartFromDurable(); await settled()
    const seeded = await page.evaluate(() => window.journalBridge.loadSnapshot())
    assert.equal(seeded.trades.length, count)
    assert.equal(seeded.backtestProjects.length, projects)
    assert.equal(domainHash(seeded), domainHash(snapshot))
    if (safetyOnly) break
    const overview = [], records = [], filter = [], saves = [], reloads = []
    await page.evaluate(() => { window.__perfLongTasks = []; new PerformanceObserver(entries => { for (const e of entries.getEntries()) window.__perfLongTasks.push(e.duration) }).observe({ type: 'longtask' }) })
    for (let i = 0; i < 13; i++) {
      const a = await navigate('/backtests', '.backtest-project-row')
      const b = await navigate('/backtests/perf-0', '.trade-row')
      const start = performance.now()
      await page.getByRole('button', { name: '待确认', exact: true }).click()
      await page.locator('.trade-row').waitFor({ state: 'hidden' })
      await frame()
      const elapsed = performance.now() - start
      await page.getByRole('button', { name: '全部记录', exact: true }).click()
      await page.locator('.trade-row').first().waitFor(); await frame()
      if (i >= 3) { overview.push(a); records.push(b); filter.push(elapsed) }
    }
    const renderedRows = await page.locator('.trade-row').count()
    const longTasks = await page.evaluate(() => window.__perfLongTasks)
    await settled()
    const durable = await page.evaluate(() => window.journalBridge.loadSnapshot())
    assert.equal(durable.trades.length, count)
    for (let i = 0; i < 5; i++) {
      durable.trades[0].note = `<p>隔离耐久保存 ${count} ${i}</p>`
      // Start inside renderer: CDP serialization of the fixture is harness work,
      // not user-perceived storage IPC latency.
      const saveMs = await page.evaluate(async snapshot => { const start = performance.now(); await window.journalBridge.saveSnapshot(snapshot); return performance.now() - start }, durable)
      saves.push(saveMs)
      assert.equal(domainHash(await page.evaluate(() => window.journalBridge.loadSnapshot())), domainHash(durable))
    }
    await restartFromDurable()
    await navigate('/backtests/perf-0', '.trade-row')
    for (let i = 0; i < 3; i++) {
      await settled()
      const start = performance.now()
      await page.reload(); await ready(); await page.locator('.trade-row').first().waitFor(); await frame()
      reloads.push(performance.now() - start)
      assert.equal(domainHash(await page.evaluate(() => window.journalBridge.loadSnapshot())), domainHash(durable))
    }
    const sample = { count, projects, importMs, overview: timings(overview), projectOpen: timings(records), pendingFilter: timings(filter), saveIPC: timings(saves), warmReload: timings(reloads), renderedRows, longTasks: { count: longTasks.length, maxMs: Math.max(0, ...longTasks) }, rendererMemory: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null) }
    report.performance.push(sample)
    console.log('PERFORMANCE', JSON.stringify(sample))
  }
  if (safetyOnly) {
    await app.evaluate(async () => {
      const session = new (process.getBuiltinModule('inspector').Session)()
      session.connect()
      global.__backtestCpuSession = session
      await new Promise((done, reject) => session.post('Profiler.enable', e => e ? reject(e) : done()))
      await new Promise((done, reject) => session.post('Profiler.start', e => e ? reject(e) : done()))
    })
    const saved = await page.evaluate(async () => { const s = await window.journalBridge.loadSnapshot(); const start = performance.now(); await window.journalBridge.saveSnapshot(s); return performance.now() - start })
    const profile = await app.evaluate(async () => {
      const s = global.__backtestCpuSession
      const result = await new Promise((done, reject) => s.post('Profiler.stop', (e, r) => e ? reject(e) : done(r)))
      s.disconnect(); delete global.__backtestCpuSession
      return result.profile
    })
    await writeFile(join(runtime, 'save-main.cpuprofile'), JSON.stringify(profile), 'utf8')
    report.mainSaveProfile = { path: join(runtime, 'save-main.cpuprofile'), saveMs: saved }
  }
  await settled()
  let baseline = await page.evaluate(() => window.journalBridge.loadSnapshot())
  const baselineHash = domainHash(baseline)
  const invalid = structuredClone(baseline); invalid.trades[0].backtestProjectId = 'nonexistent'
  const invalidImport = await page.evaluate(async snapshot => { try { await window.journalBridge.commitImport(snapshot, [], { pruneUnreferenced: true }); return { rejected: false } } catch (e) { return { rejected: true, message: String(e) } } }, invalid)
  assert.equal(invalidImport.rejected, true)
  assert.equal(domainHash(await page.evaluate(() => window.journalBridge.loadSnapshot())), baselineHash)
  assert.ok(await page.evaluate(id => window.journalBridge.getAssetBytes(id), asset.id))
  report.safety.invalidImport = { ...invalidImport, snapshotAndAttachmentUnchanged: true }
  const concurrency = await page.evaluate(async () => {
    const s = await window.journalBridge.loadSnapshot()
    const a = structuredClone(s), b = structuredClone(s)
    a.trades[0].note = '<p>CAS winner</p>'; b.trades[0].note = '<p>CAS stale</p>'
    const results = await Promise.allSettled([window.journalBridge.saveSnapshot(a), window.journalBridge.saveSnapshot(b)])
    const current = await window.journalBridge.loadSnapshot()
    return { statuses: results.map(r => r.status), current: current.trades[0].note }
  })
  assert.deepEqual(concurrency.statuses, ['fulfilled', 'rejected']); assert.equal(concurrency.current, '<p>CAS winner</p>')
  report.safety.concurrentStaleWrite = concurrency
  const backup = await page.evaluate(() => window.journalBridge.createBackup())
  assert.ok(backup)
  const fileName = basename(backup)
  const verified = await page.evaluate(name => window.journalBridge.verifyBackup(name), fileName)
  assert.equal(verified.status, 'verified')
  baseline = await page.evaluate(() => window.journalBridge.loadSnapshot())
  const originalHash = domainHash(baseline)
  const changed = structuredClone(baseline); changed.trades.splice(0, 1)
  await page.evaluate(snapshot => window.journalBridge.saveSnapshot(snapshot), changed)
  const restore = await page.evaluate(name => window.journalBridge.restoreBackup(name), fileName)
  assert.equal(restore.ok, true)
  assert.equal(domainHash(await page.evaluate(() => window.journalBridge.loadSnapshot())), originalHash)
  assert.ok(await page.evaluate(id => window.journalBridge.getAssetBytes(id), asset.id))
  report.safety.backupRestore = { verified: true, records: baseline.trades.length, projects: baseline.backtestProjects.length, exactDomainHash: originalHash, attachmentPresent: true }
  // The UI export is intentionally a separate analysis format; inspect actual download.
  await restartFromDurable(); await settled()
  await navigate('/backtests/perf-0', '.trade-row')
  await app.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(filePath)
      global.__backtestDownload = { filePath, state: 'started' }
      item.once('done', (_e, state) => { global.__backtestDownload.state = state })
    })
  }, join(runtime, 'analysis.zip'))
  await page.getByRole('button', { name: '项目操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /导出分析包/ }).click()
  const deadline = Date.now() + 30000
  let downloadState
  while (Date.now() < deadline) {
    downloadState = await app.evaluate(() => global.__backtestDownload?.state)
    if (downloadState === 'completed') break
    await page.waitForTimeout(50)
  }
  assert.equal(downloadState, 'completed', await page.locator('body').innerText())
  const zip = await JSZip.loadAsync(await readFile(join(runtime, 'analysis.zip')))
  const exported = JSON.parse(await zip.file('project.json').async('string'))
  assert.equal(exported.trades.length, 100)
  assert.ok(exported.trades.every(t => t.backtestProjectId === 'perf-0'))
  assert.ok(zip.file('trades.csv') && zip.file('README.md'))
  const attachment = exported.attachments[0]
  assert.equal(hash(await zip.file(attachment.path).async('base64')), hash(asset.data))
  report.safety.analysisExport = { records: 100, isolatedProject: true, attachmentExact: true }
  await settled()
  await app.evaluate(() => globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__.armIndeterminateSnapshotWrite())
  const fault = await page.evaluate(async () => {
    const s = await window.journalBridge.loadSnapshot(); s.trades[0].note = '<p>indeterminate durable candidate</p>'
    try { await window.journalBridge.saveSnapshot(s); return { rejected: false } } catch (e) { return { rejected: true, message: String(e) } }
  })
  assert.equal(fault.rejected, true)
  const locked = await app.evaluate(() => globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__.getState())
  assert.equal(locked.recoveryRequired, true)
  await page.getByRole('button', { name: '重新打开资料库', exact: true }).click()
  await ready()
  await page.waitForFunction(() => !document.querySelector('.save-status-recovery'))
  const recovered = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert.equal(recovered.trades[0].note, '<p>indeterminate durable candidate</p>')
  const fresh = await app.evaluate(() => globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__.getState())
  assert.notEqual(fresh.lifecycleId, locked.lifecycleId)
  assert.equal(fresh.recoveryRequired, false)
  report.safety.writeFailureRecovery = { rejected: true, locked: true, freshLifecycle: true, retainedDurableCandidate: true }
  await settled()
  const acknowledged = await page.evaluate(async () => { const s = await window.journalBridge.loadSnapshot(); s.trades[0].note = '<p>acknowledged before abrupt process death</p>'; await window.journalBridge.saveSnapshot(s); return s })
  const expectedHash = domainHash(acknowledged)
  const child = app.process()
  const dead = new Promise(done => child.once('exit', done))
  report.safety.killTarget = { launcherPid: child.pid, mainPid: await app.evaluate(() => process.pid) }
  if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(report.safety.killTarget.mainPid), '/T', '/F'])
  else child.kill('SIGKILL')
  await dead; app = undefined
  const start = performance.now()
  await launch(); await ready(); await navigate('/backtests/perf-0', '.trade-row')
  report.coldRestartMs = performance.now() - start
  assert.equal(domainHash(await page.evaluate(() => window.journalBridge.loadSnapshot())), expectedHash)
  assert.equal(acknowledged.trades.length, 10000)
  assert.equal(acknowledged.backtestProjects.length, 100)
  report.safety.acknowledgedWriteAbruptRestart = { exactDomainHash: true, records: acknowledged.trades.length, projects: acknowledged.backtestProjects.length }
  assert.deepEqual(report.errors, [])
  report.status = 'pass'
} catch (error) {
  report.status = 'fail'; report.failure = error.stack; throw error
} finally {
  if (app) await app.close()
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log('EVIDENCE', output)
}
