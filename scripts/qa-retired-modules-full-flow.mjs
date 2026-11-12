import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Every business mutation below uses an actual product control. The bridge is read-only.
const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url)
const runtime = await mkdtemp(join(tmpdir(), 'atlas-retirement-full-flow-'))
const library = join(runtime, 'library'), restoredLibrary = join(runtime, 'restored-library')
const userData = join(runtime, 'user-data'), evidence = join(runtime, 'evidence')
const output = join(root, 'test-results/module-retirement-full-flow-20261112')
await Promise.all([library, restoredLibrary, evidence, output].map(path => mkdir(path, { recursive: true })))
const pngPath = join(runtime, 'isolated-chart.png')
const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480"><rect width="960" height="480" fill="#f8f9fa"/><text x="36" y="65" font-size="25" fill="#454954">ISOLATED FULL FLOW QA / NOT MARKET DATA</text><path d="M40 380L170 275L280 320L390 215L480 250L610 135L730 210L900 110" stroke="#88ae99" stroke-width="5" fill="none"/></svg>')).png().toBuffer()
await writeFile(pngPath, png)
const checks = [], screenshots = [], errors = [], bootstrapErrors = [], identities = [], failedRequests = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const assert = (condition, message) => { if (!condition) throw Error(message) }
const hashes = {}
for (const file of ['src/App.tsx', 'src/components/TradeComposer.tsx', 'src/views/QuickNotesView.tsx', 'src/views/ReviewSessionView.tsx', 'src/lib/importExport.ts', 'src/storage/retiredSnapshotDomains.ts', 'dist-electron/main.js', 'dist/.vite/manifest.json']) hashes[file] = hash(await readFile(join(root, file)))
let application, page, collectErrors = false, phase = 'launch'
const pass = (name, detail = {}) => { checks.push({ name, ...detail }); console.log('PASS', name) }
const report = extra => writeFile(join(output, 'desktop.json'), JSON.stringify({ runtime, library, restoredLibrary, userData, hashes, checks, screenshots, errors, bootstrapErrors, failedRequests, identities, phase, ...extra }, null, 2) + '\n')
const snapshot = () => page.evaluate(() => window.journalBridge.loadSnapshot())
const untilSnapshot = async (check, message) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { const value = await snapshot(); if (value && check(value)) return value; await page.waitForTimeout(50) }
  throw Error(message)
}
const pickFolder = selected => application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, selected)
const openData = async () => {
  await page.locator('.sidebar .sb-ws').click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  await page.getByRole('link', { name: '数据', exact: true }).click()
  await page.getByRole('button', { name: '导出 .journal.zip', exact: true }).waitFor()
}
const shot = async name => {
  await page.evaluate(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
  const bytes = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  const path = join(evidence, `${name}.png`); await writeFile(path, Buffer.from(bytes, 'base64')); screenshots.push(path)
}
const launch = async expectedLibrary => {
  const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.TRADER_ATLAS_QA
  application = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: root, env, timeout: 60000 })
  page = await application.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => (collectErrors ? errors : bootstrapErrors).push(error.message))
  page.on('console', message => { if (message.type() === 'error') (collectErrors ? errors : bootstrapErrors).push(message.text()) })
  page.on('requestfailed', request => failedRequests.push({ phase, url: request.url(), error: request.failure() }))
  await page.waitForFunction(() => Boolean(window.journalBridge))
  const identity = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 900); window.center(); window.show(); window.setTitle('Trader Atlas · 隔离全流程验收')
    return { pid: process.pid, root: app.getAppPath(), userData: app.getPath('userData'), library: process.env.TRADER_ATLAS_LIBRARY }
  })
  assert(identity.root === root && await realpath(identity.userData) === await realpath(userData) && identity.library === library, 'Refuse to operate outside owned isolated app')
  identities.push(identity)
  if (expectedLibrary) {
    await page.locator('.sb-primary').waitFor()
    assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(expectedLibrary), 'Actual library differs from owned expected library')
  }
}

try {
  await launch()
  await page.waitForFunction(() => document.querySelector('.welcome-path-btn') || [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '选择其他资料库'))
  if (await page.getByRole('button', { name: '选择其他资料库', exact: true }).count()) await page.getByRole('button', { name: '选择其他资料库', exact: true }).click()
  await pickFolder(library)
  await page.getByRole('button', { name: '点击选择目录…', exact: true }).click()
  await page.getByRole('button', { name: '在此创建新资料库', exact: true }).click()
  await page.locator('.sb-primary').waitFor()
  collectErrors = true
  assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(library), 'Welcome UI created a library outside owned temp directory')
  assert((await snapshot()).trades.length === 0, 'New UI-created library must be empty')
  await page.locator('.sidebar .sb-ws').click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  await page.locator('.profile-name-input').fill('隔离全流程验收')
  await page.locator('.profile-name-row').getByRole('button', { name: '保存', exact: true }).click()
  await untilSnapshot(value => value.profile?.displayName === '隔离全流程验收', 'Isolated profile name not saved')
  await page.locator('.sidebar').getByRole('link', { name: '交易日志', exact: true }).click()
  pass('created empty temporary library through welcome UI and labeled it as isolated')

  phase = 'create-trade'
  await page.locator('.sidebar .sb-hbtn-create').click()
  const composer = page.getByRole('dialog', { name: '新建交易', exact: true })
  await composer.locator('#composer-quick-text').fill('隔离交易：高周期方向确认后等待执行。')
  await composer.getByRole('combobox', { name: '交易品种', exact: true }).click()
  await page.getByRole('option', { name: 'XAUUSD', exact: true }).click()
  await composer.getByRole('button', { name: '更多信息', exact: true }).click()
  await composer.getByLabel('入场价', { exact: true }).fill('100')
  await composer.getByLabel('仓位', { exact: true }).fill('2')
  await composer.getByLabel('止损价', { exact: true }).fill('95')
  await composer.locator('input[type=file]').setInputFiles(pngPath)
  await composer.locator('.composer-image-thumb img').waitFor()
  const previewUrl = await composer.locator('.composer-image-thumb img').getAttribute('src')
  await shot('01-new-trade-input')
  await composer.getByRole('button', { name: '保存记录', exact: true }).click()
  await page.waitForURL(/#\/trade\/TRD-1$/)
  const created = await untilSnapshot(value => value.trades.length === 1, 'Trade creation was not saved')
  const tradeId = created.trades[0].id
  assert(created.trades[0].status === 'planned' && created.trades[0].entry === 100 && created.trades[0].size === 2 && created.trades[0].stopLoss === 95, 'New trade lost explicit fields')
  const imageId = /journal-asset:\/\/([^"'\s>]+)/.exec(created.trades[0].note)?.[1]
  assert(imageId, 'Trade image has no permanent asset reference')
  const originalAsset = await page.evaluate(id => window.journalBridge.getAssetBytes(id), imageId)
  assert(originalAsset && Buffer.from(originalAsset.bytes).equals(png), 'Uploaded original image bytes changed')
  pass('created TRD-1 using product form; price, size, stop and original image saved', { tradeId, imageId, previewUrl })

  phase = 'close-trade'
  const propertiesToggle = page.locator('button.trade-detail-properties-toggle')
  await propertiesToggle.waitFor()
  if (await propertiesToggle.getAttribute('aria-expanded') !== 'true') await propertiesToggle.click()
  await page.locator('aside.dv-props button.dv-prop-row').filter({ has: page.locator('.dv-prop-label', { hasText: /^状态$/ }) }).click()
  await page.getByRole('menuitemradio', { name: '盈利', exact: true }).click()
  const closeDialog = page.locator('.modal-shell.trade-close-dialog')
  await closeDialog.getByLabel('盈亏金额', { exact: true }).fill('20')
  await closeDialog.getByLabel('R 倍数', { exact: true }).fill('2')
  await shot('02-close-trade-input')
  await closeDialog.getByRole('button', { name: '保存并待复盘', exact: true }).click()
  const closed = await untilSnapshot(value => value.trades[0]?.status === 'win', 'Close result was not persisted')
  assert(closed.trades[0].pnl === 20 && closed.trades[0].rMultiple === 2 && closed.trades[0].reviewStatus === 'unreviewed' && closed.trades[0].closedAt, 'Close result or review status is incorrect')
  assert(closed.trades[0].entry === 100 && closed.trades[0].size === 2 && closed.trades[0].stopLoss === 95 && closed.trades[0].note === created.trades[0].note, 'Closing trade changed original fields or note')
  pass('completed trade through close dialog; explicit PNL 20 and R 2 saved')

  phase = 'note-to-case'
  await page.locator('.sidebar').getByRole('link', { name: '随记', exact: true }).click()
  await page.getByRole('button', { name: '新建随记', exact: true }).click()
  await page.getByLabel('随记标题', { exact: true }).fill('隔离观察：自上而下')
  const noteEditor = page.locator('[contenteditable=true][aria-label="随记正文"]')
  await noteEditor.fill('HTF：先确认方向。MTF：等待结构。LTF：只记录执行条件。')
  await page.getByRole('button', { name: '置顶随记', exact: true }).click()
  await noteEditor.press('End'); await noteEditor.pressSequentially('最后补充：保留本段并转为案例。', { delay: 0 })
  // Convert immediately, before the 500 ms note debounce. No store/editor command injection.
  await page.getByRole('button', { name: '转为案例', exact: true }).click()
  await page.waitForURL(/#\/trade\/CAS-1$/)
  const converted = await untilSnapshot(value => value.trades.some(trade => trade.ref === 'CAS-1') && value.quickNotes?.length === 1, 'Note conversion was not persisted')
  const reviewCase = converted.trades.find(trade => trade.ref === 'CAS-1'), note = converted.quickNotes[0]
  assert(converted.trades.length === 2 && reviewCase.tradeKind === 'case' && reviewCase.caseType === 'exemplar' && reviewCase.masteryState === 'new', 'Case conversion created wrong record or duplicate')
  assert(reviewCase.note === note.contentHtml && reviewCase.note.includes('最后补充：保留本段并转为案例。') && note.pinned, 'Case conversion lost pending text or original note')
  assert(canonical(converted.trades.find(trade => trade.id === tradeId)) === canonical(closed.trades[0]), 'Converting note mutated the existing trade')
  await shot('03-converted-case')
  pass('created and edited note; immediate conversion created CAS-1 and retained original note')

  phase = 'random-review'
  await page.locator('.sidebar').getByRole('link', { name: '随机复盘', exact: true }).click()
  const allPool = page.locator('.review-session-preset-list button').filter({ hasText: '全部内容' })
  assert((await allPool.innerText()).includes('2'), 'All-content review pool should contain the trade and case')
  await allPool.click(); await page.locator('.review-session-workspace').waitFor()
  const firstRef = await page.locator('.review-session-card-ref').innerText()
  const progressBefore = await page.locator('.review-session-progress').innerText()
  await page.getByRole('button', { name: '调整范围', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert(await page.locator('.review-session-card-ref').innerText() === firstRef, 'Canceling settings changed active review')
  await page.getByRole('button', { name: '退出复盘', exact: true }).click()
  await page.locator('.sidebar').getByRole('link', { name: '随机复盘', exact: true }).click()
  await page.locator('.review-session-workspace').waitFor()
  assert(await page.locator('.review-session-card-ref').innerText() === firstRef && await page.locator('.review-session-progress').innerText() === progressBefore, 'Review exit/reentry lost progress')
  const reviewedRefs = []
  for (let index = 0; index < 2; index++) {
    reviewedRefs.push(await page.locator('.review-session-card-ref').innerText())
    if (await page.locator('.review-session-assessment-actions .is-mastered').count()) await page.locator('.review-session-assessment-actions .is-mastered').click()
    else await page.getByRole('button', { name: /^下一条/ }).click()
  }
  await page.locator('[data-review-session-finished-focus]').waitFor()
  assert(reviewedRefs.includes('TRD-1') && reviewedRefs.includes('CAS-1'), 'Normal review skipped an intended record')
  const reviewed = await untilSnapshot(value => value.trades.find(trade => trade.ref === 'CAS-1')?.masteryState === 'mastered', 'Case assessment was not saved')
  assert(canonical(reviewed.trades.find(trade => trade.id === tradeId)) === canonical(closed.trades[0]), 'Normal review changed trade financial facts')
  assert(reviewed.trades.find(trade => trade.ref === 'CAS-1').nextReviewAt === null, 'Mastered case retained a future review date')
  await shot('04-review-complete')
  pass('reviewed both records; range cancel and exit/reentry preserve progress; mastery saved', { reviewedRefs })

  phase = 'export-import'
  await openData()
  const archivePath = join(runtime, 'full-flow.journal.zip')
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, archivePath)
  await page.getByRole('button', { name: '导出 .journal.zip', exact: true }).click()
  await page.getByText('资料库已导出', { exact: true }).waitFor()
  const exported = await snapshot(), archiveHash = hash(await readFile(archivePath))
  await pickFolder(restoredLibrary)
  await page.getByRole('button', { name: '在此新建资料库…', exact: true }).click()
  await page.getByRole('button', { name: '创建并切换', exact: true }).click()
  await page.getByText('已切换到新资料库', { exact: true }).waitFor()
  assert(await realpath(await page.evaluate(() => window.journalBridge.getLibraryPath())) === await realpath(restoredLibrary), 'New restore target escaped isolated directory')
  assert((await snapshot()).trades.length === 0, 'Restore target is not empty')
  await pickFolder(archivePath)
  await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).click()
  await page.getByRole('dialog', { name: '确认恢复完整资料库', exact: true }).waitFor()
  await shot('05-restore-preview')
  await page.getByRole('button', { name: '替换当前资料库', exact: true }).click()
  await page.getByText('资料库已恢复', { exact: true }).waitFor()
  assert(canonical(await snapshot()) === canonical(exported), 'UI export/import changed persisted content')
  assert(hash(await readFile(archivePath)) === archiveHash, 'Import modified source archive')
  const restoredAsset = await page.evaluate(id => window.journalBridge.getAssetBytes(id), imageId)
  assert(restoredAsset && Buffer.from(restoredAsset.bytes).equals(png), 'Restoring changed original image bytes')
  pass('UI export/import into empty isolated library preserves all fields, original PNG and archive bytes')

  phase = 'native-reopen'
  await application.close(); application = undefined
  await launch(restoredLibrary)
  assert(canonical(await snapshot()) === canonical(exported), 'Full native close/relaunch changed saved content')
  await page.locator('.sidebar').getByRole('link', { name: '交易日志', exact: true }).click()
  await page.locator('.trade-row').filter({ hasText: 'XAUUSD' }).first().click()
  await page.waitForURL(/#\/trade\/TRD-1$/)
  await page.locator(`img[data-asset-id="${imageId}"]`).first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('img[data-asset-id]')].some(image => image.complete && image.naturalWidth > 0))
  await shot('06-reopened-trade')
  await page.locator('.sidebar').getByRole('link', { name: '案例库', exact: true }).click()
  await page.getByRole('button', { name: /^打开 .* CAS-1$/ }).click()
  await page.waitForURL(/#\/trade\/CAS-1$/)
  await page.waitForFunction(() => document.querySelector('.dv-main')?.textContent?.includes('最后补充：保留本段并转为案例。'))
  await shot('07-reopened-case')
  const reopened = await snapshot()
  assert(reopened.trades.length === 2 && reopened.quickNotes.length === 1 && reopened.trades.find(trade => trade.ref === 'CAS-1').masteryState === 'mastered', 'Reopened library lost case, note or assessment')
  assert(!/判断台|复盘组合器/.test(await page.locator('.sidebar').innerText()) && !('judgmentDesk' in reopened) && !('reviewComposer' in reopened), 'Removed module returned after restart')
  await page.locator('.sidebar').getByRole('link', { name: '随记', exact: true }).click()
  const reopenedNoteEditor = page.locator('[contenteditable=true][aria-label="随记正文"]')
  await reopenedNoteEditor.waitFor()
  assert((await reopenedNoteEditor.innerText()).includes('最后补充：保留本段并转为案例。'), 'Reopened original note is unreadable')
  await shot('08-reopened-note')
  const layout = await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable=true][aria-label="随记正文"]')
    const rect = editor.getBoundingClientRect(), style = getComputedStyle(editor)
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, editor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, fontSize: style.fontSize, lineHeight: style.lineHeight } }
  })
  assert(!layout.overflow && layout.editor.width > 0 && layout.editor.top >= 0, 'Reopened note layout is inaccessible')
  pass('fully closed and relaunched native client; trade/case/note/image/PNL/R/mastery intact')
  assert(errors.length === 0, errors.join('\n'))
  assert(!failedRequests.some(request => request.error?.errorText === 'net::ERR_FILE_NOT_FOUND'), 'A preview or original image request failed')
  await report({ result: 'passed', pid: application.process().pid, archiveHash, layout })
  console.log('REVIEW_READY', JSON.stringify({ runtime, library: restoredLibrary, pid: application.process().pid }))
  process.stdin.setEncoding('utf8'); process.stdin.on('data', async code => { try { console.log('ACTION', JSON.stringify(await eval(`(async()=>{${code}})()`))) } catch (error) { console.error(error.stack) } })
  setInterval(() => {}, 30000)
} catch (error) {
  if (page && application) await shot('failure').catch(() => {})
  await report({ result: 'failed', error: error.stack })
  await application?.close().catch(() => {})
  console.error(error.stack); process.exitCode = 1
}
