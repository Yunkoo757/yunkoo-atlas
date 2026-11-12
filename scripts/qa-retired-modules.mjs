import { _electron as electron } from 'playwright'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'

const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url)
const runtime = await mkdtemp(join(tmpdir(), 'atlas-module-retirement-'))
const library = join(runtime, 'library'), userData = join(runtime, 'user-data'), evidence = join(runtime, 'evidence')
const output = join(root, 'test-results/module-retirement-20261112')
await mkdir(evidence); await mkdir(output, { recursive: true })
await symlink(join(root, 'node_modules'), join(runtime, 'node_modules'), 'dir')
await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': join(root, 'src') } }, build: { ssr: join(root, 'scripts/fixtures/retired-modules-seed.ts'), outDir: join(runtime, 'seed'), emptyOutDir: true, rolldownOptions: { output: { entryFileNames: 'seed.mjs' } } } })
const { createRetiredModulesSeed, seedRetiredNativeLibrary } = await import(pathToFileURL(join(runtime, 'seed/seed.mjs')).href)
const { legacy, assetIds, firstTradeId } = createRetiredModulesSeed()
const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="920" height="420"><rect width="920" height="420" fill="#f8f9fa"/><text x="35" y="60" font-size="23" fill="#454954">ISOLATED MODULE REMOVAL QA / NOT MARKET DATA</text><path d="M40 320L160 270L250 300L360 175L450 230L550 150L660 210L790 105L875 145" stroke="#88ae99" stroke-width="4" fill="none"/></svg>')).png().toBuffer()
const assets = assetIds.map(id => ({ id, mime: 'image/png', data: png.toString('base64') }))
await seedRetiredNativeLibrary(library, legacy, assets)
const assert = (value, message) => { if (!value) throw new Error(message) }
const checks = [], screenshots = [], errors = []
let application, page
const hashes = {}
for (const file of ['src/App.tsx', 'src/storage/snapshotCodec.ts', 'src/storage/retiredSnapshotDomains.ts', 'electron/library/retiredSnapshotDatabase.ts', 'electron/library/backup.ts', 'src/store/useStore.ts', 'scripts/qa-retired-modules.mjs', 'dist-electron/main.js', 'dist/.vite/manifest.json']) hashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const report = extra => writeFile(join(output, 'desktop.json'), JSON.stringify({ runtime, library, userData, hashes, checks, screenshots, errors, ...extra }, null, 2))
const pass = (name, detail = {}) => { checks.push({ name, ...detail }); console.log('PASS', name) }
try {
  const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.TRADER_ATLAS_QA
  application = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: root, env, timeout: 60000 })
  page = await application.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('dialog', dialog => dialog.accept())
  await page.waitForFunction(() => Boolean(window.journalBridge))
  const identity = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), root: app.getAppPath(), library: process.env.TRADER_ATLAS_LIBRARY }))
  assert(await realpath(identity.userData) === await realpath(userData) && identity.root === root && identity.library === library, 'Unexpected test process identity')
  assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(library), 'Refuse write outside owned temporary library')
  await page.waitForSelector('.sb-primary')
  const navigate = async route => { await page.evaluate(route => { location.hash = route }, route); await page.waitForFunction(route => location.hash === `#${route}`, route) }
  const resize = (width, height, zoom = 1) => application.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(size.zoom); w.setSize(size.width, size.height); w.center(); w.show() }, { width, height, zoom })
  const shot = async name => {
    await page.evaluate(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
    const bytes = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    const path = join(evidence, `${name}.png`); await writeFile(path, Buffer.from(bytes, 'base64')); screenshots.push(path)
  }
  await resize(1440, 900); await navigate('/list')
  assert(!/判断台|复盘组合器/.test(await page.locator('.sidebar').innerText()), 'Retired module remains in sidebar')
  await shot('trade-log-1440'); pass('isolated native library and reduced sidebar', identity)
  const loaded = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert(!('judgmentDesk' in loaded) && !('reviewComposer' in loaded), 'Retired state remains in canonical native snapshot')
  assert(loaded.trades.length === 16 && loaded.trades[0].pnl === legacy.trades[0].pnl && loaded.trades[0].rMultiple === legacy.trades[0].rMultiple && loaded.weeklyReviews.length === legacy.weeklyReviews.length && loaded.quickNotes.length === legacy.quickNotes.length, 'Removal changed active business data')
  pass('legacy fields ignored; records, financial facts, weekly reviews and notes preserved')
  for (const route of ['/judgment-desk', '/review-composer', '/settings/composer-rules']) {
    await navigate(route); await page.getByRole('heading', { name: '找不到这个页面', exact: true }).waitFor()
    await page.getByRole('link', { name: '返回交易日志', exact: true }).click(); await page.waitForURL(/#\/list/)
  }
  pass('removed routes have the standard recoverable not-found page')
  await page.keyboard.press('j'); await page.keyboard.press('r')
  assert((await page.url()).endsWith('#/list'), 'Retired shortcuts still navigate')
  await page.keyboard.press('Meta+k'); await page.getByRole('dialog', { name: '搜索与命令', exact: true }).waitFor()
  const search = page.getByRole('combobox', { name: '搜索与命令', exact: true })
  for (const term of ['判断台', '复盘组合器']) {
    await search.fill(term)
    assert(await page.getByRole('option').count() === 0, `Retired command remains for ${term}`)
  }
  await page.keyboard.press('Escape'); pass('retired shortcuts and command search removed')
  await page.locator('.sb-hbtn-create').click()
  await page.getByRole('dialog', { name: '新建交易', exact: true }).waitFor()
  await shot('trade-entry-preserved'); await page.keyboard.press('Escape')
  pass('normal trade composer retained')
  await navigate(`/trade/${firstTradeId}`)
  const image = page.locator('img[data-asset-id="asset-shared-contract"]').first()
  await image.waitFor(); await image.click({ button: 'right' })
  assert(await page.getByRole('menuitem', { name: '加入判断台…', exact: true }).count() === 0, 'Retired capture action remains')
  assert(await page.getByRole('menuitem', { name: '复制图片', exact: true }).count() === 1, 'Existing image actions were removed')
  await shot('image-menu-preserved')
  await page.locator('.sb-section-label').first().click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  const asset = await page.evaluate(() => window.journalBridge.getAssetBytes('asset-shared-contract'))
  assert(asset && Buffer.from(asset.bytes).equals(png), 'Shared original image changed or disappeared')
  pass('trade image actions and original bytes retained')
  await navigate('/settings/shortcuts'); await page.getByRole('heading', { name: '键盘快捷键', exact: true }).waitFor()
  assert(!/判断台|复盘组合器/.test(await page.locator('main').innerText()), 'Retired settings or shortcuts remain')
  await shot('settings-1440'); pass('settings contains no retired module controls')
  // Exercise the surviving review workflow through real controls, including a durable case assessment.
  const financialFacts = snapshot => JSON.stringify(snapshot.trades.map(({ id, pnl, rMultiple, entry, exit, size, stopLoss }) => ({ id, pnl, rMultiple, entry, exit, size, stopLoss })))
  await navigate('/review-session')
  await page.locator('.review-session-preset-list button').filter({ hasText: '全部内容' }).click()
  await page.locator('.review-session-workspace').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.review-session-gallery img')].some(image => image.complete && image.naturalWidth > 0))
  await shot('normal-review-reading')
  for (let index = 0; index < legacy.trades.length; index++) {
    if (await page.locator('.review-session-assessment-actions .is-mastered').count()) {
      await page.locator('.review-session-assessment-actions .is-mastered').click()
    } else {
      await page.getByRole('button', { name: /^下一条/ }).click()
    }
  }
  await page.locator('[data-review-session-finished-focus]').waitFor()
  assert((await page.locator('[data-review-session-finished-focus]').innerText()).includes('已复盘 16 条交易'), 'Normal review did not finish all records')
  await shot('normal-review-finished')
  pass('normal review reads original images, browses 15 trades and assesses one case')

  // Use product UI, so export flushes and restore suspends/replaces the renderer store correctly.
  const archivePath = join(runtime, 'isolated-roundtrip.journal.zip')
  const restoredLibrary = join(runtime, 'roundtrip-library')
  await mkdir(restoredLibrary)
  await navigate('/settings/data')
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, archivePath)
  await page.getByRole('button', { name: '导出 .journal.zip', exact: true }).click()
  await page.getByText('资料库已导出', { exact: true }).waitFor()
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)
  const exported = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert(financialFacts(exported) === financialFacts(loaded), 'Normal review changed trade financial facts')
  assert(exported.trades.find(trade => trade.id === 'retirement-qa-1').masteryState === 'mastered', 'Case mastery was not saved before export')
  const archiveHash = createHash('sha256').update(await readFile(archivePath)).digest('hex')
  const archive = await JSZip.loadAsync(await readFile(archivePath))
  const SQL = await initSqlJs({ locateFile: file => join(root, 'node_modules/sql.js/dist', file) })
  const archiveDb = new SQL.Database(await archive.file('journal.db').async('uint8array'))
  try {
    const rawExported = JSON.parse(String(archiveDb.exec("SELECT value FROM meta WHERE key = 'snapshot'")[0].values[0][0]))
    assert(!/judgmentDesk|reviewComposer|judgment\./.test(JSON.stringify(rawExported)), 'Raw archive SQLite still carries retired state or navigation overrides')
  } finally { archiveDb.close() }
  const jsonPath = join(runtime, 'isolated-export.json')
  await application.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(filePath)
      globalThis.__retirementDownloadState = 'started'
      item.once('done', (_event, state) => { globalThis.__retirementDownloadState = state })
    })
  }, jsonPath)
  await page.getByRole('button', { name: '下载 JSON', exact: true }).click()
  const downloadDeadline = Date.now() + 15000
  while (Date.now() < downloadDeadline && await application.evaluate(() => globalThis.__retirementDownloadState) !== 'completed') await page.waitForTimeout(50)
  assert(await application.evaluate(() => globalThis.__retirementDownloadState) === 'completed', 'Isolated JSON download failed')
  const jsonExport = JSON.parse(await readFile(jsonPath, 'utf8'))
  assert(!('judgmentDesk' in jsonExport) && !('reviewComposer' in jsonExport), 'JSON export revived retired data')
  assert(canonical(jsonExport.trades) === canonical(exported.trades) && canonical(jsonExport.weeklyReviews) === canonical(exported.weeklyReviews) && canonical(jsonExport.quickNotes) === canonical(exported.quickNotes), 'JSON export changed active records or review content')
  assert(jsonExport.assets.every(asset => asset.id !== 'retired-only-image' && Buffer.from(asset.data, 'base64').equals(png)), 'JSON export lost original image bytes or included retired-only assets')
  pass('product JSON export preserves journal/case/review/note content without retired state')
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, restoredLibrary)
  await page.getByRole('button', { name: '在此新建资料库…', exact: true }).click()
  await page.getByRole('button', { name: '创建并切换', exact: true }).click()
  await page.getByText('已切换到新资料库', { exact: true }).waitFor()
  assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(restoredLibrary), 'Library switch escaped owned temporary directory')
  const empty = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert(empty.trades.length === 0, 'New isolated library was not empty')
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, archivePath)
  await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).click()
  await page.getByRole('dialog', { name: '确认恢复完整资料库', exact: true }).waitFor()
  await shot('archive-restore-confirmation')
  await page.getByRole('button', { name: '替换当前资料库', exact: true }).click()
  await page.getByText('资料库已恢复', { exact: true }).waitFor()
  const restored = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert(canonical(restored) === canonical(exported), 'UI archive roundtrip changed active snapshot data')
  for (const id of assetIds.filter(id => id !== 'retired-only-image')) {
    const restoredAsset = await page.evaluate(id => window.journalBridge.getAssetBytes(id), id)
    assert(restoredAsset && Buffer.from(restoredAsset.bytes).equals(png), `Archive roundtrip changed active original image ${id}`)
  }
  assert(createHash('sha256').update(await readFile(archivePath)).digest('hex') === archiveHash, 'Import modified original archive bytes')
  pass('UI ZIP export/new isolated library/import preserves all active fields and original image bytes')
  await page.reload(); await page.waitForSelector('.sb-primary')
  assert(canonical(await page.evaluate(() => window.journalBridge.loadSnapshot())) === canonical(exported), 'Reopen after archive restore changed active data')
  await navigate('/review-session')
  await page.locator('.review-session-preset-list').waitFor()
  assert(await page.locator('.review-session-preset-list button').filter({ hasText: '全部内容' }).count() === 1, 'Normal review unavailable after restore')
  pass('restored library reopens and normal review remains available')
  await navigate('/settings/data')
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, library)
  await page.getByRole('button', { name: '打开其他资料库…', exact: true }).click()
  await page.getByRole('button', { name: '确认切换', exact: true }).click()
  await page.getByText('已切换资料库', { exact: true }).waitFor()
  assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(library), 'Reopen did not return to original isolated legacy library')
  assert(canonical(await page.evaluate(() => window.journalBridge.loadSnapshot())) === canonical(exported), 'Opening original legacy library changed active data')
  pass('existing isolated legacy library opens through normal library picker')
  await resize(960, 640); await navigate('/list'); await shot('trade-log-960')
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width }))
  assert(!layout.overflow, 'Narrow desktop horizontal overflow'); pass('narrow desktop layout', layout)
  await resize(1200, 800, 1.25); await shot('trade-log-zoom125')
  await resize(1440, 900); await page.reload(); await page.waitForSelector('.sb-primary'); await navigate('/list')
  const reopened = await page.evaluate(() => window.journalBridge.loadSnapshot())
  assert(reopened.trades.length === 16 && !('judgmentDesk' in reopened) && !('reviewComposer' in reopened), 'Reload revived modules or lost records')
  assert(errors.length === 0, errors.join('\n'))
  await shot('final-review-window'); pass('reload is stable without retired runtime domains')
  await report({ result: 'passed', pid: application.process().pid, identity })
  console.log('REVIEW_READY', JSON.stringify({ runtime, library, pid: application.process().pid }))
  globalThis.retirementQa = { application, page, runtime, library, evidence }
  process.stdin.setEncoding('utf8'); process.stdin.on('data', async code => { try { console.log('ACTION', JSON.stringify(await eval(`(async()=>{${code}})()`))) } catch (error) { console.error(error.stack) } })
  setInterval(() => {}, 30000)
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  await report({ result: 'failed', error: error.stack }); await application?.close().catch(() => {})
  console.error(error.stack); process.exitCode = 1
}
