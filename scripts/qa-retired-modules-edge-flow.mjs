import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import initSqlJs from 'sql.js'
import { armNativeImportCopyFailureOnce, nativeImportCopyFaultState, restoreNativeImportCopyFault } from './fixtures/native-import-copy-fault.mjs'

// Every business mutation below uses an actual product control. The bridge is read-only.
const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url)
const runtime = await mkdtemp(join(tmpdir(), 'atlas-retirement-edge-flow-'))
const library = join(runtime, 'library'), restoredLibrary = join(runtime, 'restored-library')
const userData = join(runtime, 'user-data'), evidence = join(runtime, 'evidence')
const output = join(root, 'test-results/module-retirement-edge-flow-20261113')
await Promise.all([library, restoredLibrary, evidence, output].map(path => mkdir(path, { recursive: true })))
const pngPath = join(runtime, 'isolated-chart.png')
const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480"><rect width="960" height="480" fill="#f8f9fa"/><text x="36" y="65" font-size="25" fill="#454954">ISOLATED EDGE FLOW QA / NOT MARKET DATA</text><path d="M40 380L170 275L280 320L390 215L480 250L610 135L730 210L900 110" stroke="#88ae99" stroke-width="5" fill="none"/></svg>')).png().toBuffer()
await writeFile(pngPath, png)
const diagnostics = {}
const checks = [], screenshots = [], errors = [], bootstrapErrors = [], identities = [], failedRequests = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const assert = (condition, message) => { if (!condition) throw Error(message) }
const hashes = {}
for (const file of ['src/App.tsx', 'src/lib/tradeComposerDraftGuard.ts', 'src/lib/quickNoteConversion.ts', 'electron/library/ipc.ts', 'electron/library/preparedImportSource.ts', 'src/components/TradeComposer.tsx', 'src/views/QuickNotesView.tsx', 'src/views/ReviewSessionView.tsx', 'src/lib/importExport.ts', 'src/storage/retiredSnapshotDomains.ts', 'dist-electron/main.js', 'dist/.vite/manifest.json']) hashes[file] = hash(await readFile(join(root, file)))
let application, page, collectErrors = false, phase = 'launch'
const pass = (name, detail = {}) => { checks.push({ name, ...detail }); console.log('PASS', name) }
const report = extra => writeFile(join(output, 'desktop.json'), JSON.stringify({ runtime, library, restoredLibrary, userData, hashes, checks, screenshots, errors, bootstrapErrors, failedRequests, identities, phase, diagnostics, ...extra }, null, 2) + '\n')
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
    const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 900); window.center(); window.show(); window.setTitle('Trader Atlas · 隔离异常验收')
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
  await page.locator('.profile-name-input').fill('隔离异常验收')
  await page.locator('.profile-name-row').getByRole('button', { name: '保存', exact: true }).click()
  await untilSnapshot(value => value.profile?.displayName === '隔离异常验收', 'Isolated profile name not saved')
  await page.locator('.sidebar').getByRole('link', { name: '交易日志', exact: true }).click()
  pass('created empty temporary library through welcome UI and labeled it as isolated')



  phase = 'import-synthetic-baseline'
  const prior = JSON.parse(await readFile(join(root, 'test-results/module-retirement-full-flow-20261112/desktop.json'), 'utf8'))
  assert(prior.result === 'passed' && resolve(prior.runtime).startsWith(join(tmpdir(), 'atlas-retirement-full-flow-')), 'Only a verified, owned synthetic baseline is permitted')
  const baselineArchive = join(prior.runtime, 'full-flow.journal.zip')
  assert(hash(await readFile(baselineArchive)) === prior.archiveHash, 'Synthetic baseline archive no longer matches verified bytes')
  const archiveDialog = () => page.getByRole('dialog', { name: '确认恢复完整资料库', exact: true })
  const prepareArchive = async archive => {
    await pickFolder(archive)
    await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).click()
    await archiveDialog().waitFor()
  }
  const exportArchive = async path => {
    await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, path)
    await page.getByRole('button', { name: '导出 .journal.zip', exact: true }).click()
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const bytes = await readFile(path).catch(() => null)
      if (bytes?.length) return hash(bytes)
      await page.waitForTimeout(50)
    }
    throw Error('Native archive export did not finish')
  }
  const SQL = await initSqlJs()
  const databaseContent = async () => {
    const bytes = await readFile(join(library, 'journal.db')), database = new SQL.Database(bytes)
    try {
      return { database: hash(bytes), revision: Number(database.exec("SELECT value FROM meta WHERE key='snapshotRevision'")[0]?.values[0]?.[0] ?? 0), databaseContent: hash(canonical({ meta: database.exec("SELECT key,value FROM meta WHERE key <> 'snapshotRevision' ORDER BY key"), assets: database.exec('SELECT * FROM assets ORDER BY id') })) }
    } finally { database.close() }
  }
  const libraryBytes = async () => ({
    ...await databaseContent(),
    manifest: hash(await readFile(join(library, 'manifest.json'))),
    attachments: await Promise.all((await readdir(join(library, 'attachments'))).sort().map(async name => [name, hash(await readFile(join(library, 'attachments', name)))])),
  })
  const sameLibraryContent = (left, right) => { const stripFlushRevision = ({ database, revision, ...content }) => content; return canonical(stripFlushRevision(left)) === canonical(stripFlushRevision(right)) }
  await openData(); await prepareArchive(baselineArchive)
  await archiveDialog().getByRole('button', { name: '替换当前资料库', exact: true }).click()
  await archiveDialog().waitFor({ state: 'hidden' })
  const baseline = await untilSnapshot(value => value.trades.length === 2 && value.quickNotes?.length === 1, 'Synthetic baseline did not restore')
  const baselineTrades = new Map(baseline.trades.map(trade => [trade.id, canonical(trade)]))
  const baselineNotes = new Map(baseline.quickNotes.map(note => [note.id, canonical(note)]))
  const originalId = /journal-asset:\/\/([^"'\s>]+)/.exec(baseline.trades.find(trade => trade.ref === 'TRD-1').note)?.[1]
  assert(originalId, 'Verified baseline original is missing')
  const originalBytes = Buffer.from((await page.evaluate(id => window.journalBridge.getAssetBytes(id), originalId)).bytes)
  const assertOriginals = async (label, ignoreMastery = false) => {
    const value = await snapshot()
    for (const [id, source] of baselineTrades) {
      const actual = value.trades.find(trade => trade.id === id)
      if (ignoreMastery && actual?.tradeKind === 'case') {
        const stripAssessment = trade => Object.fromEntries(Object.entries(trade).filter(([key]) => !['masteryState', 'nextReviewAt', 'reviewStatus', 'reviewCategory', 'updatedAt'].includes(key)))
        assert(canonical(stripAssessment(actual)) === canonical(stripAssessment(JSON.parse(source))), `${label}: existing case content changed`)
      } else assert(canonical(actual) === source, `${label}: existing trade/case changed`)
    }
    for (const [id, source] of baselineNotes) assert(canonical(value.quickNotes.find(note => note.id === id)) === source, `${label}: existing source note changed`)
    const bytes = await page.evaluate(id => window.journalBridge.getAssetBytes(id), originalId)
    assert(bytes && Buffer.from(bytes.bytes).equals(originalBytes), `${label}: existing original image bytes changed`)
    assert(new Set(value.trades.map(trade => trade.id)).size === value.trades.length && new Set(value.trades.map(trade => trade.ref)).size === value.trades.length, `${label}: duplicate ID/ref`)
    assert(hash(await readFile(baselineArchive)) === prior.archiveHash, `${label}: source archive changed`)
  }
  pass('restored verified synthetic baseline into a fresh temporary library; no real library opened', { originalId, baselineHash: prior.archiveHash })
  await page.getByRole('link', { name: '资料', exact: true }).click()
  await page.locator('.profile-name-input').fill('隔离异常验收')
  await page.locator('.profile-name-row').getByRole('button', { name: '保存', exact: true }).click()
  await untilSnapshot(value => value.profile?.displayName === '隔离异常验收', 'Post-import isolated label not saved')

  phase = 'cancel-unsaved-composer'
  await page.locator('.sidebar').getByRole('link', { name: '交易日志', exact: true }).click()
  const openComposer = async () => {
    await page.locator('.sidebar .sb-hbtn-create').click()
    const dialog = page.getByRole('dialog', { name: '新建交易', exact: true }); await dialog.waitFor(); return dialog
  }
  let composer = await openComposer()
  const draftText = '隔离草稿：取消和退出都必须保留本段。'
  await composer.locator('#composer-quick-text').fill(draftText)
  await composer.locator('input[type=file]').setInputFiles(pngPath)
  const preview = composer.locator('.composer-image-thumb img')
  await preview.waitFor()
  const previewUrl = await preview.getAttribute('src')
  const assertDraft = async label => {
    assert(await composer.locator('#composer-quick-text').inputValue() === draftText, `${label}: text draft lost`)
    assert(await preview.getAttribute('src') === previewUrl, `${label}: original preview replaced`)
    assert(await preview.evaluate(async image => { await image.decode(); return image.naturalWidth === 960 }), `${label}: preview no longer decodes`)
    assert((await snapshot()).trades.length === 2, `${label}: cancellation accidentally created record`)
    await assertOriginals(label)
  }
  const discardDialog = () => page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true })
  await composer.getByRole('button', { name: '取消', exact: true }).click()
  await discardDialog().waitFor(); await shot('01-cancel-unsaved-confirmation')
  await discardDialog().getByRole('button', { name: '继续编辑', exact: true }).click()
  await assertDraft('cancel and continue')
  await composer.getByRole('button', { name: '关闭', exact: true }).click()
  await discardDialog().waitFor(); await discardDialog().press('Escape')
  await discardDialog().waitFor({ state: 'hidden' }); await assertDraft('close X then dismiss confirmation')
  await composer.press('Escape'); await discardDialog().waitFor()
  await discardDialog().getByRole('button', { name: '继续编辑', exact: true }).click()
  await assertDraft('escape then continue')
  pass('Cancel, X and Escape all ask before discarding; dismissing confirmation retains text and original preview without record creation')

  phase = 'native-quit-unsaved-composer'
  await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
  const quitReceipt = () => page.getByRole('dialog', { name: '保存未完成，已取消退出', exact: true })
  await quitReceipt().waitFor(); await shot('02-native-unsaved-exit-blocked')
  await quitReceipt().getByRole('button', { name: '继续使用', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert(await quitReceipt().evaluate(dialog => dialog.contains(document.activeElement)), 'Exit receipt keyboard focus left the topmost confirmation')
  await quitReceipt().getByRole('button', { name: '继续使用', exact: true }).click()
  await quitReceipt().waitFor({ state: 'hidden' }); await assertDraft('native quit refused')
  await composer.getByRole('button', { name: '保存记录', exact: true }).dblclick()
  await page.waitForURL(/#\/trade\/TRD-2$/)
  const withSavedDraft = await untilSnapshot(value => value.trades.length === 3 && value.trades.some(trade => trade.ref === 'TRD-2'), 'Saved draft did not create exactly one record')
  const savedDraft = withSavedDraft.trades.find(trade => trade.ref === 'TRD-2')
  assert(savedDraft.note.includes(draftText), 'Saving refused-close draft lost text')
  const newImageId = /journal-asset:\/\/([^"'\s>]+)/.exec(savedDraft.note)?.[1]
  assert(newImageId && Buffer.from((await page.evaluate(id => window.journalBridge.getAssetBytes(id), newImageId)).bytes).equals(png), 'Saving refused-close draft changed original bytes')
  await assertOriginals('save draft')
  pass('native quit refuses unsubmitted form, keeps text/image and reachable controls; double save produces exactly one TRD-2', { savedDraftId: savedDraft.id, newImageId })

  phase = 'explicit-discard'
  composer = await openComposer()
  await composer.locator('#composer-quick-text').fill('此段用户明确放弃，不得生成记录')
  await composer.locator('input[type=file]').setInputFiles(pngPath)
  await composer.getByRole('button', { name: '取消', exact: true }).click()
  await discardDialog().getByRole('button', { name: '放弃修改', exact: true }).click()
  await composer.waitFor({ state: 'hidden' })
  composer = await openComposer()
  assert(await composer.locator('#composer-quick-text').inputValue() === '' && await composer.locator('.composer-image-thumb img').count() === 0, 'Explicitly discarded form leaked into new draft')
  await composer.getByRole('button', { name: '取消', exact: true }).click()
  assert((await snapshot()).trades.length === 3, 'Explicit discard created a record')
  await assertOriginals('explicit discard')
  pass('explicit discard clears only the unsubmitted form; reopen is empty and existing records/originals stay intact')

  phase = 'rapid-note-conversion'
  await page.locator('.sidebar').getByRole('link', { name: '随记', exact: true }).click()
  await page.getByRole('button', { name: '新建随记', exact: true }).click()
  const afterNewNote = await untilSnapshot(value => value.quickNotes?.length === 2, 'New note did not persist')
  const newNoteId = afterNewNote.quickNotes.find(note => !baselineNotes.has(note.id)).id
  await page.waitForURL(url => url.hash === `#/notes/${newNoteId}`)
  await page.getByLabel('随记标题', { exact: true }).fill('隔离：重复点击转案例')
  let noteEditor = page.locator('[contenteditable=true][aria-label="随记正文"]')
  await noteEditor.fill('转换前草稿，不等空闲保存：一次手势只生成一个案例。')
  await page.getByRole('button', { name: '转为案例', exact: true }).dblclick()
  await page.waitForURL(/#\/trade\/CAS-2$/)
  const withCase = await untilSnapshot(value => value.trades.length === 4 && value.quickNotes?.length === 2, 'Rapid note conversion created incorrect records')
  const conversionNote = withCase.quickNotes.find(note => note.title === '隔离：重复点击转案例')
  assert(conversionNote && withCase.trades.find(trade => trade.ref === 'CAS-2')?.note === conversionNote.contentHtml, 'Immediate conversion lost source draft')
  await assertOriginals('rapid note conversion')
  pass('native double-click conversion before debounce creates exactly one CAS-2 and preserves the source note', { noteId: conversionNote.id })

  phase = 'invalid-import-and-cancel'
  await openData()
  const preInvalid = await snapshot(), bytesPreInvalid = await libraryBytes()
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).click()
  await page.getByRole('dialog', { name: '正在检查归档', exact: true }).waitFor({ state: 'hidden' })
  assert(await archiveDialog().count() === 0, 'Canceled file picker unexpectedly prepared restore')
  await page.getByRole('button', { name: '导出 .journal.zip', exact: true }).click()
  await page.getByText('已取消导出', { exact: true }).waitFor()
  diagnostics.pickerCancellation = { before: preInvalid, after: await snapshot(), bytesBefore: bytesPreInvalid, bytesAfter: await libraryBytes() }
  assert(canonical(diagnostics.pickerCancellation.after) === canonical(preInvalid) && sameLibraryContent(diagnostics.pickerCancellation.bytesAfter, bytesPreInvalid), 'Canceling native import/export picker changed existing data')
  pass('native import and export file-picker cancellation creates no candidate, archive or record')
  const damagedArchive = join(runtime, 'invalid-copy.journal.zip')
  await writeFile(damagedArchive, 'ISOLATED QA invalid archive, not a ZIP')
  const damagedHash = hash(await readFile(damagedArchive))
  await pickFolder(damagedArchive)
  await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).click()
  await page.getByRole('dialog', { name: '正在检查归档', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '选择 .journal.zip', exact: true }).waitFor({ state: 'visible' })
  await page.getByText('归档检查失败，请重试', { exact: true }).waitFor()
  assert(canonical(await snapshot()) === canonical(preInvalid) && sameLibraryContent(await libraryBytes(), bytesPreInvalid), 'Invalid archive preflight changed existing library')
  assert(hash(await readFile(damagedArchive)) === damagedHash, 'Preflight mutated invalid source input')
  const malformedJson = join(runtime, 'invalid-copy.json')
  await writeFile(malformedJson, '{not valid json')
  await page.locator('input[accept=".json,application/json"]').setInputFiles(malformedJson)
  await page.getByText('JSON 备份的数据合同无效。', { exact: true }).waitFor()
  assert(canonical(await snapshot()) === canonical(preInvalid) && sameLibraryContent(await libraryBytes(), bytesPreInvalid), 'Malformed JSON import changed existing library')
  await shot('03-invalid-archive-preserved-library')
  await prepareArchive(baselineArchive)
  await archiveDialog().getByRole('button', { name: '取消', exact: true }).click()
  await archiveDialog().waitFor({ state: 'hidden' })
  assert(canonical(await snapshot()) === canonical(preInvalid) && sameLibraryContent(await libraryBytes(), bytesPreInvalid), 'Canceling valid import preview changed existing library')
  await assertOriginals('invalid/canceled import')
  pass('invalid archive fails without writes; canceling valid preview leaves database, manifest, records, originals and source bytes unchanged')

  phase = 'partial-import-failure'
  const retryArchive = join(runtime, 'edge-before-failure.journal.zip')
  const retryArchiveHash = await exportArchive(retryArchive)
  await prepareArchive(baselineArchive)
  const beforeFailure = await snapshot(), beforeFailureBytes = await libraryBytes()
  await armNativeImportCopyFailureOnce(application, runtime, library)
  await archiveDialog().getByRole('button', { name: '替换当前资料库', exact: true }).click()
  await archiveDialog().waitFor({ state: 'hidden' })
  const fault = await nativeImportCopyFaultState(application)
  await restoreNativeImportCopyFault(application)
  assert(fault?.hits === 1 && fault.partialMutationReached && !fault.armed, 'Failure did not exercise partial native install rollback exactly once')
  assert(canonical(await snapshot()) === canonical(beforeFailure), 'Partial install rollback changed records or drafts')
  assert(sameLibraryContent(await libraryBytes(), beforeFailureBytes), 'Partial install rollback changed database, manifest or original attachment bytes')
  assert(hash(await readFile(retryArchive)) === retryArchiveHash, 'Failed restore changed the source archive')
  diagnostics.importRollback = { before: beforeFailureBytes, after: await libraryBytes() }
  await assertOriginals('partial import rollback')
  await shot('04-rollback-cleared-expired-preview')
  pass('injected one native attachment-copy EIO after database replacement; rollback restores database logical content/manifest/original bytes (explicit save revisions retained) and clears expired preview', { fault })

  const selectNewNote = async expectedBody => {
    await page.locator('.sidebar').getByRole('link', { name: '随记', exact: true }).click()
    await page.locator('.quick-notes-list-item.is-active').waitFor()
    await page.locator('[contenteditable=true][aria-label="随记正文"]').waitFor()
    await page.locator('.quick-notes-list-item').filter({ hasText: '隔离：重复点击转案例' }).click()
    await page.waitForFunction(({ id, body }) => location.hash === `#/notes/${id}` && document.querySelector('.quick-notes-list-item.is-active')?.textContent?.includes('隔离：重复点击转案例') && document.querySelector('[contenteditable=true][aria-label="随记正文"]')?.textContent === body, { id: newNoteId, body: expectedBody })
    noteEditor = page.locator('[contenteditable=true][aria-label="随记正文"]')
  }
  phase = 'edit-after-rollback'
  await selectNewNote('转换前草稿，不等空闲保存：一次手势只生成一个案例。')
  const postRollbackText = '回滚后继续编辑成功；不能卡在失效的写入会话。'
  await noteEditor.fill(postRollbackText)
  await untilSnapshot(value => value.quickNotes?.find(note => note.id === newNoteId)?.contentHtml.includes(postRollbackText), 'Rollback did not restore a writable storage session')
  await assertOriginals('edit after rollback')
  await openData()
  const finalArchive = join(runtime, 'edge-retry.journal.zip')
  const finalArchiveHash = await exportArchive(finalArchive)
  const beforeRetry = await snapshot()
  await prepareArchive(finalArchive)
  await archiveDialog().getByRole('button', { name: '替换当前资料库', exact: true }).dblclick()
  await archiveDialog().waitFor({ state: 'hidden' })
  await untilSnapshot(value => canonical(value) === canonical(beforeRetry), 'Fresh preview retry changed records or duplicated data')
  assert(hash(await readFile(finalArchive)) === finalArchiveHash, 'Successful retry mutated source archive')
  await assertOriginals('successful import retry')
  pass('after rollback the note remains writable; fresh preview retry succeeds exactly once and preserves every record/financial field/original')

  phase = 'reopen-during-preview'
  await prepareArchive(finalArchive)
  const previewBeforeReopen = await snapshot()
  await shot('05-preview-before-native-close')
  await application.close(); application = undefined
  await launch(library)
  assert(canonical(await snapshot()) === canonical(previewBeforeReopen), 'Closing in import preview committed or lost content')
  assert(await archiveDialog().count() === 0, 'Import preview was auto-committed/reused on relaunch')
  await assertOriginals('reopen during preview')
  pass('native close/relaunch during import preview performs no replacement and reuses no stale preview token')

  phase = 'reopen-pending-note'
  await selectNewNote(postRollbackText)
  const immediatelyBeforeQuit = '最后输入后立刻正常退出：应由退出屏障保存，不等待空闲。'
  await noteEditor.fill(immediatelyBeforeQuit)
  await application.close(); application = undefined
  await launch(library)
  const reopened = await snapshot()
  assert(reopened.quickNotes.some(note => note.contentHtml.includes(immediatelyBeforeQuit)), 'Normal quit before debounce lost final text')
  assert(reopened.trades.length === 4 && reopened.quickNotes.length === 2, 'Reopen generated duplicates or lost records')
  await assertOriginals('pending draft full relaunch')
  pass('normal native close immediately after note input flushes pending draft; new process restores 4 unique records, 2 notes and exact original images')

  phase = 'reopen-mid-review'
  await page.locator('.sidebar').getByRole('link', { name: '随机复盘', exact: true }).click()
  await page.locator('.review-session-preset-list button').filter({ hasText: '全部内容' }).click()
  await page.locator('.review-session-workspace').waitFor()
  if (await page.locator('.review-session-assessment-actions .is-mastered').count()) {
    const assessedRef = await page.locator('.review-session-card-ref').innerText()
    await page.locator('.review-session-assessment-actions .is-mastered').click()
    await untilSnapshot(value => value.trades.some(trade => trade.ref === assessedRef && trade.masteryState === 'mastered' && trade.reviewStatus === 'reviewed' && trade.reviewCategory === 'mastered' && trade.nextReviewAt === null), 'Explicit case assessment did not persist')
  } else await page.getByRole('button', { name: /^下一条/ }).click()
  const reviewRef = await page.locator('.review-session-card-ref').innerText(), reviewProgress = await page.locator('.review-session-progress').innerText()
  await page.getByRole('button', { name: '退出复盘', exact: true }).click()
  await page.locator('.sidebar').getByRole('link', { name: '随机复盘', exact: true }).click()
  await page.locator('.review-session-workspace').waitFor()
  assert(await page.locator('.review-session-card-ref').innerText() === reviewRef && await page.locator('.review-session-progress').innerText() === reviewProgress, 'Same-session exit/reentry lost review cursor')
  pass('mid-round page exit/reentry resumes the same record and cursor', { reviewRef, reviewProgress })
  const beforeReviewClose = await snapshot()
  await application.close(); application = undefined
  await launch(library)
  await page.locator('.sidebar').getByRole('link', { name: '随机复盘', exact: true }).click()
  // Existing product contract: the round uses sessionStorage; only filters persist across processes.
  await page.locator('.review-session-preset-list').waitFor()
  assert(await page.locator('.review-session-workspace').count() === 0, 'Full app relaunch unexpectedly reused a process-local round')
  assert(canonical(await snapshot()) === canonical(beforeReviewClose), 'Mid-review reopen mutated saved record content')
  await assertOriginals('mid review reopen', true)
  await page.locator('.review-session-preset-list button').filter({ hasText: '全部内容' }).click()
  await page.locator('.review-session-workspace').waitFor()
  await shot('06-native-reopened-review-ready')
  pass('mid-round full native relaunch preserves records/assessments/originals and can start review normally; session-local round resets as designed')

  phase = 'visual-and-final'
  await page.getByRole('button', { name: '退出复盘', exact: true }).click()
  await page.locator('.sidebar').getByRole('link', { name: '交易日志', exact: true }).click()
  composer = await openComposer()
  await composer.locator('#composer-quick-text').fill('小桌面窗口退出保护可达性验收')
  await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.setSize(960, 640); window.center(); setTimeout(() => app.quit(), 0)
  })
  await quitReceipt().waitFor()
  const layout = await quitReceipt().evaluate(dialog => {
    const rect = dialog.getBoundingClientRect(), style = getComputedStyle(dialog)
    const buttons = [...dialog.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(), s = getComputedStyle(button); return { name: button.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom, fontSize: s.fontSize, lineHeight: s.lineHeight } })
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, modal: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, fontSize: style.fontSize, lineHeight: style.lineHeight }, buttons }
  })
  assert(!layout.overflow && layout.modal.left >= 0 && layout.modal.top >= 0 && layout.modal.right <= layout.width && layout.modal.bottom <= layout.height, 'Exit protection overflows smaller supported desktop')
  assert(layout.buttons.every(button => button.left >= 0 && button.top >= 0 && button.right <= layout.width && button.bottom <= layout.height), 'Exit protection buttons unreachable')
  await shot('07-small-desktop-unsaved-receipt')
  await quitReceipt().getByRole('button', { name: '继续使用', exact: true }).click()
  await composer.getByRole('button', { name: '取消', exact: true }).click()
  await discardDialog().getByRole('button', { name: '放弃修改', exact: true }).click()
  await selectNewNote(immediatelyBeforeQuit)
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 900); window.center() })
  await shot('08-final-isolated-notes')
  assert(errors.length === 0, errors.join('\n'))
  assert(failedRequests.length === 0, 'A preview/original resource request failed')
  await report({ result: 'passed', pid: application.process().pid, priorRuntime: prior.runtime, layout, finalCounts: { records: (await snapshot()).trades.length, notes: (await snapshot()).quickNotes.length } })
  console.log('REVIEW_READY', JSON.stringify({ runtime, library, pid: application.process().pid }))
  process.stdin.setEncoding('utf8'); process.stdin.on('data', async code => { try { console.log('ACTION', JSON.stringify(await eval(`(async()=>{${code}})()`))) } catch (error) { console.error(error.stack) } })
  setInterval(() => {}, 30000)

}
catch (error) {
  if (page && application) await shot('failure').catch(() => {})
  await report({ result: 'failed', error: error.stack, failureSnapshot: page ? await snapshot().catch(() => null) : null })
  await application?.close().catch(() => {})
  console.error(error.stack); process.exitCode = 1
}
