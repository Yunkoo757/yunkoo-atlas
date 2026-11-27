import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import initSqlJs from 'sql.js'
import { _electron as electron } from 'playwright'

import { readGitProvenance } from './git-provenance.mjs'
import {
  assertRepositoryProvenanceUnchanged,
  collectElectronBundleIdentity,
  publishEvidenceAfterCleanup,
  readRepositoryBuildExpectation,
  removeTemporaryDirectoryBounded,
} from './bundle-build-identity.mjs'

const root = process.cwd()
const require = createRequire(import.meta.url)
const outputIndex = process.argv.indexOf('--output')
const outputPath = path.resolve(
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? process.argv[outputIndex + 1]
    : path.join('test-results', 'storage-recovery', 'storage-recovery-electron.json'),
)
// 前置校验失败也不得留下上一轮可被 workflow `if: always()` 上传的 pass。
fs.rmSync(outputPath, { force: true })
const buildExpectation = await readRepositoryBuildExpectation(root)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertBuildPresent() {
  for (const required of ['dist/index.html', 'dist-electron/main.js']) {
    if (!fs.existsSync(path.join(root, required))) {
      throw new Error(`${required} is missing; run pnpm build:app before storage recovery QA`)
    }
  }
}

async function readQaState(application) {
  return application.evaluate(() => {
    const controller = globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__
    if (!controller) {
      throw new Error('主进程未安装 storage recovery QA controller')
    }
    return controller.getState()
  })
}

async function waitForQaState(application, predicate, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await readQaState(application)
    if (predicate(state)) return state
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

async function readDurableSnapshot(libraryPath) {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file),
  })
  const database = new SQL.Database(fs.readFileSync(path.join(libraryPath, 'journal.db')))
  try {
    const result = database.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const value = result[0]?.values[0]?.[0]
    assert(typeof value === 'string', '退出后 journal.db 必须保留 snapshot')
    return JSON.parse(value)
  } finally {
    database.close()
  }
}

function verifyOperationRevisions(userData, kind, startStage, status, before, after) {
  const log = fs.readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8')
  const records = log.split('\n').filter(line => line.includes(` ${kind}:`)).map(line => JSON.parse(line.slice(line.indexOf('{'))))
  const start = records.findLast(record => record.status === 'start' && record.stage === startStage)
  assert(start, `${kind} 缺少 ${startStage} 开始事件`)
  const pair = records.filter(record => record.operationId === start.operationId)
  assert(pair.length === 2 && pair[1].status === status, `${kind} 必须恰好记录一次终态 ${status}`)
  assert(start.revisionBefore === before && start.revisionAfter === before &&
    pair[1].revisionBefore === before && pair[1].revisionAfter === after, `${kind} 日志与实际操作版本不符`)
}

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
  const prepared = await prepare()
  assert(prepared.ok, '必须先通过候选库准备')
  const config = path.join(userDataPath, 'library-config.json')
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

async function verifyCutoverReceipts(application, page, libraryPath, candidatePath, userDataPath) {
  // 替换已提交后，单独查询版本可能被下一次独占操作拒绝。
  // 本阶段只保留普通快照读取，禁止通过第二条版本 IPC 补齐写入回执。
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('storage:getSnapshotRevision')
    ipcMain.handle('storage:getSnapshotRevision', () => { throw new Error('isolated revision query unavailable') })
  })
  const backup = await page.evaluate(() => window.journalBridge.createBackup())
  assert(backup, '无法创建隔离备份')
  const { candidateBackup, ...receipts } = await page.evaluate(async ({ libraryPath, candidatePath, backupName }) => {
    const bridge = window.journalBridge
    const previous = await bridge.loadSnapshot()
    const stale = await bridge.commitStageRollover({
      expectedCurrentStageId: 'obsolete',
      expectedRollover: { id: 'obsolete', requestedAt: '2026-08-30', effectiveWeekStart: '2026-08-31', postponedCount: 0 },
    })
    if (stale.ok || stale.reason !== 'stale') throw new Error('旧阶段请求须返回原有的拒绝原因')
    await bridge.saveSnapshot({ ...previous, tagPresets: ['before-backup-cutover'] })
    const restored = await bridge.restoreBackup(backupName)
    if (!restored.ok || restored.snapshot.tagPresets[0] !== 'post-recovery-follow-up') throw new Error('备份恢复回执与快照不符')
    await bridge.saveSnapshot(restored.snapshot)

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
      return activated.snapshot
    }
    if (await activate(candidatePath, 'create') !== null) throw new Error('新建目标应为空')
    await bridge.saveSnapshot({ ...previous, tagPresets: ['isolated-second-library'] })
    const candidateBackup = await bridge.createBackup()
    const original = await activate(libraryPath, 'open')
    if (original?.tagPresets[0] !== 'post-recovery-follow-up') throw new Error('切回原库后必须读到原快照')
    await bridge.saveSnapshot(original)
    return { candidateBackup, staleStage: stale.reason, backup: true, archive: true, create: true, reopen: true }
  }, { libraryPath, candidatePath, backupName: path.basename(backup) })
  const retention = await verifyRejectedSwitchPreservesBackups(page, libraryPath, candidatePath, userDataPath, candidateBackup)
  return { ...receipts, retention }
}

function waitForMainFrameNavigation(page, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      page.off('framenavigated', listener)
    }
    const listener = (frame) => {
      if (frame !== page.mainFrame()) return
      cleanup()
      resolve()
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('恢复 CTA 未在时限内启动 renderer navigation'))
    }, timeoutMs)
    page.on('framenavigated', listener)
  })
}

async function exitQaProcessWithoutRendererFlush(application) {
  const child = application.process()
  let exitCode = child.exitCode
  let exitSignal = child.signalCode
  let childError
  child.once('error', (error) => { childError = error })
  const alreadyExited = exitCode !== null || exitSignal !== null
  const exited = alreadyExited
    ? Promise.resolve()
    : new Promise((resolve) => {
        child.once('exit', (code, signal) => {
          exitCode = code
          exitSignal = signal
          resolve()
        })
      })
  const settlesWithin = async (promise, timeoutMs) => {
    let timeout
    const outcome = await Promise.race([
      Promise.resolve(promise).then(
        () => ({ kind: 'fulfilled' }),
        (error) => ({ kind: 'rejected', error }),
      ),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
      }),
    ])
    clearTimeout(timeout)
    return outcome
  }
  const observeExitWithin = async (timeoutMs) => {
    if (exitCode !== null || exitSignal !== null) return true
    return (await settlesWithin(exited, timeoutMs)).kind === 'fulfilled'
  }
  // follow-up 已由 fresh LibraryStorage 原子提交；这里刻意跳过 renderer 退出 flush，
  // 否则仍停留在旧 UI store 的夹具会制造一次无关的第二次业务写入。
  const request = await settlesWithin(
    application.evaluate(({ app }) => app.exit(0)),
    2_000,
  )
  let requestError
  if (
    request.kind === 'rejected' &&
    !/closed|destroyed|Target page/i.test(String(request.error))
  ) {
    requestError = request.error
  } else if (request.kind === 'timeout') {
    requestError = new Error('隔离 Electron QA 的 app.exit 请求超时')
  }

  if (await observeExitWithin(10_000)) {
    if (requestError) throw requestError
    if (childError) throw childError
    assert(exitCode === 0 && exitSignal === null, `隔离 Electron QA 进程退出异常：${exitCode}/${exitSignal}`)
    return
  }

  let killError
  try {
    process.kill(child.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') killError = error
  }
  const killed = await observeExitWithin(5_000)
  const timeoutError = new Error(
    killed
      ? '隔离 Electron QA 未能优雅退出，已执行 bounded SIGKILL 清理'
      : `隔离 Electron QA 进程 ${child.pid} 在 bounded SIGKILL 后仍未退出`,
  )
  const failures = [requestError, killError, timeoutError].filter(Boolean)
  if (childError) failures.unshift(childError)
  throw failures.length === 1
    ? failures[0]
    : new AggregateError(failures, 'Storage recovery QA process cleanup failed')
}

assertBuildPresent()

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-atlas-storage-recovery-'))
const userDataPath = path.join(temporaryRoot, 'user-data')
const libraryPath = path.join(temporaryRoot, 'library')
const executablePath = require('electron')
let application
let primaryError
let evidence
let bundleIdentity

try {
  application = await electron.launch({
    executablePath,
    args: ['.', `--user-data-dir=${userDataPath}`],
    cwd: root,
    env: {
      ...process.env,
      TRADER_ATLAS_LIBRARY: libraryPath,
      TRADER_ATLAS_STORAGE_RECOVERY_QA: '1',
      VITE_DEV_SERVER_URL: '',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  })
  const page = await application.firstWindow({ timeout: 30_000 })
  bundleIdentity = await collectElectronBundleIdentity({
    page,
    application,
    expectation: buildExpectation,
  })
  await page.waitForFunction(() => Boolean(window.journalBridge), undefined, { timeout: 30_000 })

  fs.mkdirSync(libraryPath, { recursive: true })
  const created = await page.evaluate(async (nextLibraryPath) => {
    if (!window.journalBridge) throw new Error('Electron bridge unavailable')
    return window.journalBridge.createNewLibrary(nextLibraryPath)
  }, libraryPath)
  assert(created.ok, `隔离资料库创建失败：${created.error ?? 'unknown error'}`)

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(
    () => document.documentElement.dataset.uiSettled === '1' && Boolean(window.journalBridge),
    undefined,
    { timeout: 30_000 },
  )
  const seeded = await page.evaluate(async () => {
    const bridge = window.journalBridge
    if (!bridge) throw new Error('Electron bridge unavailable after bootstrap')
    const snapshot = await bridge.loadSnapshot()
    if (!snapshot) throw new Error('Electron bootstrap did not create an initial snapshot')
    const next = structuredClone(snapshot)
    next.tagPresets = ['before-storage-recovery']
    await bridge.saveSnapshot(next)
    return next
  })
  assert(seeded.tagPresets?.[0] === 'before-storage-recovery', '恢复故障前基线快照保存失败')

  const importBefore = await page.evaluate(() => window.journalBridge.getSnapshotRevision())
  assert(importBefore > 0, '先提交非零版本以识别伪造的零值')
  await page.evaluate(snapshot => window.journalBridge.commitImport(snapshot, []), seeded)
  const importAfter = await page.evaluate(() => window.journalBridge.getSnapshotRevision())
  assert(importAfter === importBefore + 1, '实际导入必须推进资料库版本')
  verifyOperationRevisions(userDataPath, 'import', 'validate', 'success', importBefore, importAfter)

  const archivePath = path.join(temporaryRoot, 'isolated-recovery.journal.zip')
  await application.evaluate(({ dialog }, archive) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: archive })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] })
  }, archivePath)
  const previewToken = await page.evaluate(async () => {
    const bridge = window.journalBridge
    const exported = await bridge.exportJournalZip()
    if (!exported.ok) throw new Error('隔离库导出失败')
    const prepared = await bridge.prepareJournalImport('before-recovery')
    if (!prepared.ok) throw new Error('隔离归档必须通过真实预检')
    return prepared.preview.token
  })

  verifyOperationRevisions(userDataPath, 'archive', 'export', 'success', importAfter, importAfter)
  const mainProcessId = await application.evaluate(() => process.pid)
  const before = await readQaState(application)
  assert(typeof before.lifecycleId === 'string', '故障前必须存在活动 LibraryStorage lifecycle')
  assert(before.recoveryRequired === false, '故障前 storage 不得已处于 recovery lock')

  await application.evaluate(() => {
    const controller = globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__
    if (!controller) throw new Error('主进程 QA controller 不可用')
    controller.armIndeterminateSnapshotWrite()
  })
  const fault = await page.evaluate(async () => {
    const bridge = window.journalBridge
    if (!bridge) throw new Error('Electron bridge unavailable before fault')
    const snapshot = await bridge.loadSnapshot()
    if (!snapshot) throw new Error('Missing snapshot before fault')
    const candidate = structuredClone(snapshot)
    candidate.tagPresets = ['fresh-disk-recovery-sentinel']
    try {
      await bridge.saveSnapshot(candidate)
      return { rejected: false, message: '' }
    } catch (error) {
      return {
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })
  assert(fault.rejected, '故障注入必须让 renderer 的 snapshot IPC 拒绝')

  const locked = await readQaState(application)
  assert(locked.lifecycleId === before.lifecycleId, '恢复前必须仍是旧 storage lifecycle')
  assert(locked.recoveryRequired === true, '故障注入必须锁住旧 storage lifecycle')

  const recoveryButton = page.getByRole('button', { name: '重新打开资料库', exact: true })
  await recoveryButton.waitFor({ state: 'visible', timeout: 15_000 })
  await application.evaluate(() => {
    const controller = globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__
    if (!controller) throw new Error('主进程 QA controller 不可用')
    controller.holdNextRecoveryBeforeRendererReload()
  })
  const rendererNavigation = waitForMainFrameNavigation(page)
  const recoveryClick = recoveryButton.click()
  const held = await waitForQaState(
    application,
    (state) => state.rendererReloadHeld === true && state.lifecycleId !== before.lifecycleId,
    '恢复必须在 fresh storage 激活后、主框架提交前保持 exclusive gate',
  )
  const staleRendererWrite = await page.evaluate(async (snapshot) => {
    const bridge = window.journalBridge
    if (!bridge) throw new Error('stale renderer bridge unavailable')
    try {
      await bridge.saveSnapshot(snapshot)
      return { rejected: false, message: '' }
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) }
    }
  }, seeded)
  assert(staleRendererWrite.rejected, '主框架提交前旧 renderer 尾部写 IPC 必须被拒绝')
  assert(
    staleRendererWrite.message.includes('交易库正在切换、导入或恢复'),
    '旧 renderer 尾部写必须由 exclusive gate 返回明确 busy 错误',
  )
  // 这些入口也会打开数据库。持锁期间只允许恢复请求自己消费磁盘上的事务标记。
  const competing = await page.evaluate(async token => {
    const bridge = window.journalBridge
    const message = async work => {
      try { await work(); return '' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    }
    const [status, stage, prepare, commit, archive] = await Promise.all([
      message(() => bridge.getLibraryStatus()),
      message(() => bridge.commitStageRollover({
        expectedCurrentStageId: 'previous',
        expectedRollover: { id: 'previous-schedule', requestedAt: '2026-08-30', effectiveWeekStart: '2026-08-31', postponedCount: 0 },
      })),
      bridge.prepareJournalImport('during-recovery'),
      bridge.commitPreparedJournalImport(token),
      message(() => bridge.exportJournalZip()),
    ])
    return { status, stage, prepare, commit, archive }
  }, previewToken)
  assert(competing.status.includes('交易库正在切换'), '状态查询也必须由独占门拒绝')
  assert(competing.archive.includes('交易库正在切换'), '导出必须与恢复互斥')
  verifyOperationRevisions(userDataPath, 'archive', 'export', 'failure', null, null)
  assert(competing.stage.includes('stage:commitRollover') && competing.stage.includes('交易库正在切换'), '阶段重置必须在验证写入会话之前取得独占权')
  assert(!competing.prepare.ok && competing.prepare.error?.includes('交易库正在切换'), '预检不得在恢复期间捕获活动库')
  assert(!competing.commit.ok && competing.commit.code === 'LIBRARY_BUSY' && competing.commit.committed === false,
    '已准备的归档必须返回可辨别的忙状态，不能抢先打开活动库')
  await application.evaluate(() => {
    const controller = globalThis.__TRADER_ATLAS_STORAGE_RECOVERY_QA__
    if (!controller) throw new Error('主进程 QA controller 不可用')
    controller.releaseRecoveryRendererReload()
  })
  await Promise.all([rendererNavigation, recoveryClick])
  // Playwright 的 framenavigated 与 Electron 主进程的 did-navigate 是两个独立观察者；
  // 前者触发后仍需等待主进程 observer 写入证据，并确认 recovery IPC 已结束。
  const after = await waitForQaState(
    application,
    (state) =>
      state.mainFrameNavigationCommitted === true &&
      state.recoveryInProgress === false,
    '恢复必须等到主进程确认主框架提交并结束 recovery IPC',
  )
  // 生命周期替换发生在主进程发起 navigation 之前；先断言它，确保把
  // renderer-only reload mutation 立即判成 RED，而不是等待旧实例启动超时。
  const mainProcessIdAfter = await application.evaluate(() => process.pid)
  assert(mainProcessIdAfter === mainProcessId, 'exclusive reopen 不应偷偷替换为未验证的第二个主进程')
  assert(after.lifecycleId !== before.lifecycleId, '恢复 CTA 必须替换主进程 LibraryStorage lifecycle')
  assert(after.recoveryRequired === false, 'fresh storage lifecycle 不得继承旧实例 recovery lock')
  assert(after.mainFrameNavigationStarted === true, '真实 Electron 必须观测到主框架 reload 开始')
  assert(after.mainFrameNavigationCommitted === true, '真实 Electron 必须观测到主框架 reload 提交')
  assert(after.exclusiveAtNavigationStart === true, '主框架 reload 开始时 recovery gate 必须仍为 exclusive')
  assert(after.exclusiveAtMainFrameCommit === true, '主框架 did-navigate 提交时 recovery gate 必须仍为 exclusive')

  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 })
  await page.waitForFunction(
    () => document.documentElement.dataset.uiSettled === '1' && Boolean(window.journalBridge),
    undefined,
    { timeout: 30_000 },
  )

  const recovered = await page.evaluate(async () => {
    const bridge = window.journalBridge
    if (!bridge) throw new Error('Electron bridge unavailable after recovery reload')
    const snapshot = await bridge.loadSnapshot()
    if (!snapshot) throw new Error('Fresh storage did not load a snapshot from disk')
    const sentinel = snapshot.tagPresets?.[0]
    const followUp = structuredClone(snapshot)
    followUp.tagPresets = ['post-recovery-follow-up']
    await bridge.saveSnapshot(followUp)
    return { sentinel, followUp: followUp.tagPresets?.[0] }
  })
  assert(
    recovered.sentinel === 'fresh-disk-recovery-sentinel',
    'fresh storage 必须加载故障后 journal.db 的磁盘真相',
  )
  assert(recovered.followUp === 'post-recovery-follow-up', 'fresh storage 必须接受后续耐久写入')

  const cutoverReceipts = await verifyCutoverReceipts(application, page, libraryPath, path.join(temporaryRoot, 'isolated-second-library'), userDataPath)
  evidence = {
    cutoverReceipts,
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: os.arch(),
    mainProcessId,
    mainProcessIdAfter,
    oldLifecycleId: before.lifecycleId,
    newLifecycleId: after.lifecycleId,
    oldLifecycleLocked: locked.recoveryRequired,
    exclusiveHeldBeforeMainFrameCommit: held.rendererReloadHeld,
    staleRendererWriteRejected: staleRendererWrite.rejected,
    staleRendererWriteMessage: staleRendererWrite.message,
    competingRequests: competing,
    importRevisionBefore: importBefore,
    importRevisionAfter: importAfter,
    mainFrameNavigationStarted: after.mainFrameNavigationStarted,
    mainFrameNavigationCommitted: after.mainFrameNavigationCommitted,
    exclusiveAtNavigationStart: after.exclusiveAtNavigationStart,
    exclusiveAtMainFrameCommit: after.exclusiveAtMainFrameCommit,
    recoveryInProgressAfterCommit: after.recoveryInProgress,
    newLifecycleLocked: after.recoveryRequired,
    recoveredSentinel: recovered.sentinel,
    followUpSentinel: recovered.followUp,
    rendererRecoveryAction: 'storage:recover IPC -> main-process exclusive fresh LibraryStorage -> renderer reload',
    bundleIdentity,
    status: 'pass',
  }
  const exitingApplication = application
  application = undefined
  await exitQaProcessWithoutRendererFlush(exitingApplication)
} catch (error) {
  primaryError = error
} finally {
  if (application) {
    try {
      if (primaryError) await exitQaProcessWithoutRendererFlush(application)
      else await application.close()
    } catch (closeError) {
      primaryError = primaryError
        ? new AggregateError([primaryError, closeError], 'Storage recovery QA and cleanup both failed')
        : closeError
    }
  }
}

if (!primaryError) {
  try {
    const durable = await readDurableSnapshot(libraryPath)
    assert(
      durable.tagPresets?.[0] === 'post-recovery-follow-up',
      '进程关闭后 raw journal.db 必须保留 recovery 后续写入',
    )
    const finalProvenance = await readGitProvenance(root)
    assertRepositoryProvenanceUnchanged(buildExpectation, finalProvenance)
    Object.assign(evidence, finalProvenance)
    evidence.durableSentinelAfterExit = durable.tagPresets[0]
  } catch (error) {
    primaryError = error
  }
}

if (primaryError) {
  try {
    await removeTemporaryDirectoryBounded(temporaryRoot)
  } catch (cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'Storage recovery QA and temporary cleanup both failed')
  }
  throw primaryError
}

await publishEvidenceAfterCleanup({
  cleanup: () => removeTemporaryDirectoryBounded(temporaryRoot),
  publish: async () => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    process.stdout.write(`PASS storage recovery Electron lifecycle: ${outputPath}\n`)
  },
})
