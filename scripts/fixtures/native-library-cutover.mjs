import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

async function verifyRejectedSwitchPreservesBackups(page, libraryPath, candidatePath, userDataPath, candidateBackup) {
  const activeBackup = await page.evaluate(() => window.journalBridge.createBackup())
  assert(activeBackup && candidateBackup, '隔离库必须各有一份原生备份样本')
  function seedRetentionHistory(sample) {
    const dir = path.dirname(sample)
    const names = new Set(fs.readdirSync(dir).filter(name => /^journal-.*\.db$/.test(name)))
    for (let day = 1; names.size < 9; day++) {
      const name = `journal-2025-01-${String(day).padStart(2, '0')}-00-00-00-000Z.db`
      if (names.has(name)) continue
      for (const suffix of ['', '.meta.json', '.manifest.json']) {
        fs.copyFileSync(sample + suffix, path.join(dir, name + suffix), fs.constants.COPYFILE_EXCL)
      }
      names.add(name)
    }
    return [...names].sort()
  }
  const oldNames = seedRetentionHistory(activeBackup)
  const candidateNames = seedRetentionHistory(candidateBackup)
  const list = sample => fs.readdirSync(path.dirname(sample)).filter(name => /^journal-.*\.db$/.test(name)).sort()
  const prepare = () => page.evaluate(root => window.journalBridge.prepareLibrarySwitch(root, 'open'), candidatePath)
  const activate = token => page.evaluate(id => window.journalBridge.activatePreparedLibrary(id), token)
  const config = path.join(userDataPath, 'library-config.json')
  const originalConfig = fs.readFileSync(config)
  const beforeReplacement = await prepare()
  assert.ok(beforeReplacement.ok)
  const manifest = path.join(candidatePath, 'manifest.json')
  const originalManifest = fs.readFileSync(manifest)
  try {
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(originalManifest), libraryId: randomUUID() }), 'utf8')
    const replaced = await activate(beforeReplacement.token)
    assert.equal(replaced.ok, false)
    assert.match(replaced.error, /交易库已变化/)
    assert.equal(await page.evaluate(() => window.journalBridge.getLibraryPath()), libraryPath)
    assert.deepEqual(fs.readFileSync(config), originalConfig)
  } finally {
    fs.writeFileSync(manifest, originalManifest)
  }
  const prepared = await prepare()
  assert(prepared.ok, '重新选择后必须能再次准备')
  const saved = config + '.isolated-fixture'
  fs.renameSync(config, saved)
  let rejected
  try {
    fs.mkdirSync(config)
    try { rejected = await activate(prepared.token) }
    finally { fs.rmdirSync(config) }
  } finally {
    fs.renameSync(saved, config)
  }
  assert(!rejected.ok && rejected.error.includes('无法保存交易库位置'), '配置提交失败必须保留原库')
  assert(await page.evaluate(() => window.journalBridge.getLibraryPath()) === libraryPath, '失败后活动资料库发生变化')
  await page.evaluate(async () => { const bridge = window.journalBridge; return bridge.saveSnapshot(await bridge.loadSnapshot()) })
  const remainingOld = list(activeBackup)
  const remainingCandidate = list(candidateBackup)
  assert(JSON.stringify(oldNames) === JSON.stringify(remainingOld) &&
    JSON.stringify(candidateNames) === JSON.stringify(remainingCandidate),
    `拒绝切库后两库备份应全部保留，实际为 ${remainingOld.length}/${oldNames.length} 与 ${remainingCandidate.length}/${candidateNames.length}`)
  const retry = await prepare()
  assert(retry.ok && (await activate(retry.token)).ok, '恢复配置后应能激活同一候选')
  assert(list(candidateBackup).length === 7 && list(activeBackup).length === oldNames.length, '成功切库后仅轮换新库')
  return { sourceRetained: oldNames.length, candidateRetained: candidateNames.length, candidateAfterActivation: 7 }
}

async function verifyConfigPublication(application, page, libraryPath, candidatePath, userDataPath) {
  // 只干预隔离 userData 中、已经 rename 的临时配置文件。Windows 同样执行这条收尾路径。
  async function activateWithFinalizationFault(target, denyReadback) {
    const prepared = await page.evaluate(dir => window.journalBridge.prepareLibrarySwitch(dir, 'open'), target)
    assert(prepared.ok, '隔离位置配置用例必须先取得切库候选')
    await application.evaluate(({ app }, input) => {
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(input.userData)) throw new Error('隔离配置路径不符')
      const config = path.join(app.getPath('userData'), 'library-config.json')
      const remove = fs.rmSync
      const read = fs.readFileSync
      let injected = false
      fs.rmSync = function (file, ...args) {
        if (!injected && typeof file === 'string' && path.dirname(file) === path.dirname(config) &&
          path.basename(file).startsWith('.library-config.json.' + process.pid + '.') &&
          file.endsWith('.tmp') && !fs.existsSync(file)) {
          injected = true
          throw new Error('isolated failure after publishing config')
        }
        return remove.call(this, file, ...args)
      }
      fs.readFileSync = function (file, ...args) {
        if (injected && input.denyReadback && file === config) throw new Error('isolated config readback failure')
        return read.call(this, file, ...args)
      }
      globalThis.restoreConfigFault = () => {
        fs.rmSync = remove
        fs.readFileSync = read
        delete globalThis.restoreConfigFault
        return injected
      }
    }, { userData: userDataPath, denyReadback })
    try {
      return await page.evaluate(token => window.journalBridge.activatePreparedLibrary(token), prepared.token)
    } finally {
      const injected = await application.evaluate(() => globalThis.restoreConfigFault())
      assert(injected, '必须在配置替换后触发隔离故障')
    }
  }

  const confirmed = await activateWithFinalizationFault(libraryPath, false)
  assert(confirmed.ok && confirmed.snapshot?.tagPresets[0] === 'post-recovery-follow-up', '已独立核对的位置应完成切换')
  await page.evaluate(snap => window.journalBridge.saveSnapshot(snap), confirmed.snapshot)
  const unconfirmed = await activateWithFinalizationFault(candidatePath, true)
  assert(!unconfirmed.ok && unconfirmed.requiresReload, '配置已替换但无法确认时必须要求重新打开')
  const selected = JSON.parse(fs.readFileSync(path.join(userDataPath, 'library-config.json'), 'utf8'))
  assert(selected.libraryPath === candidatePath, '故障时实际配置应已替换')
  const blocked = await page.evaluate(async snap => {
    try { await window.journalBridge.saveSnapshot(snap); return false } catch { return true }
  }, confirmed.snapshot)
  assert(blocked, '配置结果未确认后必须拒绝旧窗口保存')
  const reopened = await page.evaluate(async () => {
    const bridge = window.journalBridge
    await bridge.storageOpen()
    const snapshot = await bridge.loadSnapshot()
    await bridge.saveSnapshot(snapshot)
    return { path: await bridge.getLibraryPath(), tag: snapshot.tagPresets[0] }
  })
  assert(reopened.path === candidatePath && reopened.tag === 'isolated-second-library', '重开必须读取配置指出的库及原快照')
  return { recoveredAfterWriteError: true, unconfirmedWriteBlocked: blocked, reopenedCandidate: true }
}

async function verifyStaleBackupConfirmation(page) {
  await page.evaluate(() => { location.hash = '/list' })
  await page.waitForFunction(() => location.hash === '#/list' && !document.querySelector('.data-settings'))
  const created = await page.evaluate(() => window.journalBridge.createVerifiedBackup())
  assert.equal(created?.status, 'verified')
  await page.evaluate(() => { location.hash = '/settings/data' })
  await page.locator('summary').filter({ hasText: '查看备份' }).click()
  const list = await page.evaluate(() => window.journalBridge.listBackups())
  assert.equal(list[0].name, path.basename(created.path))
  await page.getByRole('button', { name: '删除此备份' }).first().click()
  const confirmation = page.getByRole('dialog', { name: '删除这个备份？' })
  await confirmation.waitFor()
  const reopened = await page.evaluate(selected => window.journalBridge.restoreBackup(selected), list[0])
  assert.ok(reopened.ok)
  await confirmation.getByRole('button', { name: '删除备份', exact: true }).click()
  await page.getByText('删除失败，请重新选择备份', { exact: true }).waitFor()
  assert.ok(fs.existsSync(created.path), '旧确认不得删除同路径重开后的同名备份')
}

export async function verifyCutoverReceipts({ application, page: workspace, libraryPath, candidatePath, userDataPath }) {
  // 界面阶段已完成真实恢复和接续保存。创建同一主进程的专用窗口，使旧界面的
  // beforeunload 自动保存与直接 IPC 验收相互独立。窗口仍加载相同受信入口与生产 preload。
  await verifyStaleBackupConfirmation(workspace)
  const abandonedPreview = await workspace.evaluate(() => window.journalBridge.previewAssetPurge())
  const trustedUrl = workspace.url()
  const nextWindow = application.waitForEvent('window')
  const { workspaceId, bridgeId } = await application.evaluate(({ BrowserWindow }, { url, preload }) => {
    const original = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)
    if (!original) throw new Error('无法定位已完成恢复的隔离工作台')
    const { sandbox, contextIsolation, nodeIntegration } = original.webContents.getLastWebPreferences()
    const bridge = new BrowserWindow({ show: false, webPreferences: { preload, sandbox, contextIsolation, nodeIntegration } })
    void bridge.loadURL('about:blank')
    return { workspaceId: original.id, bridgeId: bridge.id }
  }, { url: trustedUrl, preload: path.resolve('dist-electron/preload.cjs') })
  const page = await nextWindow
  let blockedRendererScripts = 0
  await page.route('**/*', route => {
    if (route.request().resourceType() !== 'script') return route.continue()
    blockedRendererScripts++
    return route.abort()
  })
  await application.evaluate(async ({ BrowserWindow }, { workspaceId, bridgeId, trustedUrl }) => {
    BrowserWindow.fromId(workspaceId).destroy()
    await BrowserWindow.fromId(bridgeId).loadURL(trustedUrl)
  }, { workspaceId, bridgeId, trustedUrl })
  await page.waitForURL(trustedUrl)
  assert.equal(page.url(), trustedUrl)
  assert.ok(blockedRendererScripts > 0)
  const savedTag = await page.evaluate(async () => {
    const bridge = window.journalBridge
    if (!bridge || document.querySelector('#root')?.childElementCount !== 0) throw new Error('桥接验收需要原生 preload 和空的界面挂载点')
    await bridge.storageOpen()
    return (await bridge.loadSnapshot())?.tagPresets[0]
  })
  assert.equal(savedTag, 'post-recovery-follow-up', '实际恢复界面的后续保存应能由新的窗口会话读回')
  await assert.rejects(
    page.evaluate(preview => window.journalBridge.commitAssetPurge(preview), abandonedPreview),
    /预览无效或已使用/,
    '接管同一资料库的新窗口必须拒绝原文档遗留的附件清理预览',
  )
  const prepareNew = () => page.evaluate(dir => window.journalBridge.prepareLibrarySwitch(dir, 'create'), candidatePath)
  const inPage = await prepareNew()
  assert.ok(inPage.ok)
  const nextHash = new URL(page.url()).hash === '#/settings/data' ? '#/settings/profile' : '#/settings/data'
  const navigated = page.waitForURL(url => url.hash === nextHash)
  await page.evaluate(hash => { location.hash = hash }, nextHash)
  await navigated
  assert.ok(await page.evaluate(token => window.journalBridge.cancelPreparedLibrary(token), inPage.token))
  const oldDocument = await prepareNew()
  assert.ok(oldDocument.ok)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(() => window.journalBridge.storageOpen())
  assert.equal(await page.evaluate(token => window.journalBridge.cancelPreparedLibrary(token), oldDocument.token), false)
  const freshDocument = await prepareNew()
  assert.ok(freshDocument.ok)
  assert.ok(await page.evaluate(token => window.journalBridge.cancelPreparedLibrary(token), freshDocument.token))

  // 替换已提交后，单独查询版本可能被下一次独占操作拒绝。
  // 本阶段只保留普通快照读取，禁止通过第二条版本 IPC 补齐写入回执。
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('storage:getSnapshotRevision')
    ipcMain.handle('storage:getSnapshotRevision', () => { throw new Error('isolated revision query unavailable') })
  })
  const backup = await page.evaluate(() => window.journalBridge.createVerifiedBackup())
  assert.equal(backup?.status, 'verified', '同一写入请求须返回原生校验结果')
  const { verification } = JSON.parse(fs.readFileSync(backup.path + '.meta.json', 'utf8'))
  assert.equal(verification.status, backup.status)
  assert.equal(verification.checkedAt, backup.checkedAt)
  const { candidateBackup, ...receipts } = await page.evaluate(async ({ libraryPath, candidatePath, backupName }) => {
    const listed = (await window.journalBridge.listBackups()).find(item => item.name === backupName)
    if (!listed) throw new Error('创建回执未出现在原库备份列表')
    const bridge = window.journalBridge
    const previous = await bridge.loadSnapshot()
    const stale = await bridge.commitStageRollover({
      expectedCurrentStageId: 'obsolete',
      expectedRollover: { id: 'obsolete', requestedAt: '2026-08-30', effectiveWeekStart: '2026-08-31', postponedCount: 0 },
    })
    if (stale.ok || stale.reason !== 'stale') throw new Error('旧阶段请求须返回原有的拒绝原因')
    await bridge.saveSnapshot({ ...previous, tagPresets: ['before-backup-cutover'] })
    const restored = await bridge.restoreBackup(listed)
    if (!restored.ok || restored.snapshot.tagPresets[0] !== 'post-recovery-follow-up') throw new Error('备份恢复回执与快照不符')
    await bridge.saveSnapshot(restored.snapshot)
    // 同路径恢复已重开实例，旧列表中的同名项不可继续操作。
    for (const operation of [() => bridge.deleteBackup(listed), () => bridge.verifyBackup(listed)]) {
      try { await operation() } catch (error) {
        if (String(error).includes('备份列表已过期')) continue
        throw error
      }
      throw new Error('同目录重开后接受了旧列表的备份操作')
    }

    const prepared = await bridge.prepareJournalImport('receipt-check')
    if (!prepared.ok) throw new Error('隔离恢复归档应可预检')
    const journal = await bridge.commitPreparedJournalImport(prepared.preview.token)
    if (!journal.ok || journal.snapshot.tagPresets[0] !== 'before-storage-recovery') throw new Error('归档恢复回执与快照不符')
    await bridge.saveSnapshot(previous)

    const activate = async (root, mode) => {
      const candidate = await bridge.prepareLibrarySwitch(root, mode)
      if (!candidate.ok) throw new Error('无法准备隔离资料库')
      const activated = await bridge.activatePreparedLibrary(candidate.token)
      if (!activated.ok) throw new Error('无法激活隔离资料库')
      if (activated.path !== root) throw new Error('切库回执中的路径与实际选定的隔离库不符')
      return activated.snapshot
    }
    if (await activate(candidatePath, 'create') !== null) throw new Error('新建目标应为空')
    await bridge.saveSnapshot({ ...previous, tagPresets: ['isolated-second-library'] })
    const candidateBackup = await bridge.createBackup()
    const original = await activate(libraryPath, 'open')
    if (original?.tagPresets[0] !== 'post-recovery-follow-up') throw new Error('切回原库后必须读到原快照')
    await bridge.saveSnapshot(original)
    return { candidateBackup, staleStage: stale.reason, backup: true, archive: true, create: true, reopen: true }
  }, { libraryPath, candidatePath, backupName: path.basename(backup.path) })
  const staleSourceRejected = await page.evaluate(async ({ libraryPath, candidatePath }) => {
    const bridge = window.journalBridge
    const ready = await bridge.prepareLibrarySwitch(candidatePath, 'open')
    if (!ready.ok) throw Error(ready.error)
    for (const dir of [candidatePath, libraryPath]) {
      const opened = await bridge.openExistingLibrary(dir)
      if (!opened.ok) throw Error(opened.error)
      if (opened.path !== dir) throw Error('直接开库回执应包含已确认的路径')
    }
    await bridge.storageOpen()
    const stale = await bridge.activatePreparedLibrary(ready.token)
    return !stale.ok && stale.error?.includes('当前交易库已变化') && await bridge.getLibraryPath() === libraryPath
  }, { libraryPath, candidatePath })
  assert.ok(staleSourceRejected, '回到相同路径的新实例后仍须拒绝原资料库的切换请求')
  const retention = await verifyRejectedSwitchPreservesBackups(page, libraryPath, candidatePath, userDataPath, candidateBackup)
  const location = await verifyConfigPublication(application, page, libraryPath, candidatePath, userDataPath)
  return { ...receipts, retention, location, staleBackupConfirmationRejected: true, abandonedPreviewRejected: true, staleSourceRejected, switchDocumentChecked: true }
}
