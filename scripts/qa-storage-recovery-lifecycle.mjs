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

  evidence = {
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
