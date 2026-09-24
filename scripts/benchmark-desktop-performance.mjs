import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'
import { createAnalyticsSnapshot } from './fixtures/analytics-trades.mjs'
import { summarizeTimings } from './benchmark-analytics.mjs'

// Always owns both directories. Never attach to a user's existing client or library.
const require = createRequire(import.meta.url)
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? 'current'
const keepOpen = process.argv.includes('--keep-open')
const verify = process.argv.includes('--verify')
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid evidence label')
const output = resolve('test-results/performance', label)
mkdirSync(output, { recursive: true })
const isolatedRoot = mkdtempSync(join(tmpdir(), 'atlas-performance-'))
const userData = join(isolatedRoot, 'user-data')
const library = join(isolatedRoot, 'library')
mkdirSync(library)
const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const application = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: resolve('.'), env, timeout: 60_000 })
const errors = []
try {
  const page = await application.firstWindow()
  page.on('dialog', dialog => { void dialog.accept().catch(() => {}) })
  page.on('pageerror', error => errors.push(error.message))
  const actualUserData = await application.evaluate(({ app }) => app.getPath('userData'))
  assert.equal(resolve(actualUserData), resolve(userData))
  const created = await page.evaluate(path => window.journalBridge.createNewLibrary(path), library)
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(resolve(await page.evaluate(() => window.journalBridge.getLibraryPath())), resolve(library))
  await page.evaluate(async () => { await window.journalBridge.storageOpen(); await window.journalBridge.loadSnapshot() })
  const snapshot = createAnalyticsSnapshot({ count: 10_000, noteProfile: '2kb' })
  snapshot.profile.displayName = '性能验收 · 隔离样例 10K'
  snapshot.trades = snapshot.trades.map(trade => ({ ...trade, images: [], note: '<p>性能验收隔离样例，趋势与风险记录。</p>'.repeat(50) }))
  const imported = await page.evaluate(payload => window.journalBridge.commitImport(payload, [], { pruneUnreferenced: true }), snapshot)
  assert.ok(imported)
  console.log('Isolated 10K library imported')
  await page.reload()
  await page.waitForSelector('.sidebar')
  const ready = async () => {
    await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1')
    await page.waitForSelector('.tl-row, [data-trade-id]')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  await ready()
  console.log('10K list ready')
  const reload = []
  for (let run = 0; run < 13; run++) {
    // Startup may normalize persisted preferences. Let that real save finish before
    // navigation so Electron's unsaved-changes guard is never bypassed for timing.
    await page.waitForTimeout(1200)
    await page.waitForFunction(() => !document.querySelector('.save-status.is-dirty, .save-status.is-saving, .save-status-recovery'))
    const start = performance.now()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (run >= 3) reload.push(performance.now() - start)
  }
  const capture = async (name, width, height) => {
    await application.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(size.width, size.height) }, { width, height })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {}))))
    await page.screenshot({ path: join(output, `${name}.png`) })
    return page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      rows: document.querySelectorAll('[data-trade-id]').length,
      bodyFont: getComputedStyle(document.body).fontSize,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, withinViewport: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, fontSize: style.fontSize, lineHeight: style.lineHeight }
      }),
    }))
  }
  const windows = [await capture('list-1440', 1440, 960), await capture('list-minimum', 960, 640)]
  if (process.argv.includes('--profile')) {
    const cdp = await page.context().newCDPSession(page)
    await page.waitForTimeout(1200)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    const { profile } = await cdp.send('Profiler.stop')
    writeFileSync(join(output, 'reload.cpuprofile'), JSON.stringify(profile), 'utf8')
    await cdp.detach()
  }
  const interactions = []
  if (verify) {
    for (const width of [960, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, width === 960 ? 640 : 960), width)
      await page.locator('.sb-hbtn-search').click()
      await page.locator('.cmdk-input').fill('趋势')
      await page.locator('.cmdk-item').first().waitFor()
      interactions.push({ kind: 'search', width, resultCount: await page.locator('.cmdk-item').count(), ...(await capture(`search-${width}`, width, width === 960 ? 640 : 960)) })
      await page.keyboard.press('Escape')
      await page.locator('.cmdk-input').waitFor({ state: 'hidden' })
      await page.locator('.sb-hbtn-create').click()
      await page.locator('.composer-modal').waitFor()
      await page.getByRole('button', { name: '更多信息', exact: true }).click()
      interactions.push({ kind: 'composer', width, ...(await capture(`composer-${width}`, width, width === 960 ? 640 : 960)) })
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.locator('.composer-modal').waitFor({ state: 'hidden' })
    }
    await page.locator('a[href^="#/dashboard"]').first().click()
    await page.locator('.db-scroll').waitFor()
    interactions.push({ kind: 'dashboard', ...(await capture('dashboard-1440', 1440, 960)) })
    await page.locator('a[href^="#/list"]').first().click()
    await ready()
  }
  const report = { label, generatedAt: new Date().toISOString(), isolation: { isolatedRoot, userData, library }, count: snapshot.trades.length, reloadToList: summarizeTimings(reload), windows, interactions, errors, buildIdentity: JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))['index.html'].file }
  writeFileSync(join(output, 'desktop.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [])
  if (keepOpen) {
    console.log('Latest isolated desktop remains open for review')
    await new Promise(resolve => application.on('close', resolve))
  }
} finally {
  await application.close()
}
