import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron } from 'playwright'
import initSqlJs from 'sql.js'
import { SCHEMA_VERSION } from '../src/storage/types.ts'

import {
  closeElectronApplicationBounded,
  collectElectronBundleIdentity,
  readRepositoryBuildExpectation,
  removeTemporaryDirectoryBounded,
  validateBundleBuildIdentityEvidence,
} from './bundle-build-identity.mjs'
import {
  parseFinalPackagedArtifactArgs,
  validateFinalPackagedArtifactReport,
} from './final-packaged-artifact-contract.mjs'
import { createDesktopVisualSnapshot } from './fixtures/desktop-visual-seed.mjs'

const root = process.cwd()

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

function payloadHash(filePath) {
  const bytes = fs.statSync(filePath).size
  if (bytes <= 0) throw new Error(`Final packaged payload is empty: ${filePath}`)
  return { path: path.resolve(filePath), bytes, sha256: sha256(filePath) }
}

function processExists(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
}

export function waitForSpawnedChildExitBounded(child, {
  timeoutMs,
  killGraceMs = 5_000,
  label = 'child process',
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isFinite(killGraceMs) || killGraceMs <= 0) {
    throw new Error('Child process timeout and kill grace must be positive numbers')
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let timedOut = false
    let timeoutHandle = null
    let killGraceHandle = null
    let killError = null

    const cleanupListeners = () => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      if (killGraceHandle !== null) clearTimeout(killGraceHandle)
      child.removeListener?.('exit', onExit)
      child.removeListener?.('error', onError)
    }
    const resolveOnce = (value) => {
      if (settled) return
      settled = true
      cleanupListeners()
      resolvePromise(value)
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      cleanupListeners()
      // A late spawn error must never become an unhandled EventEmitter error after the bounded rejection.
      child.on?.('error', () => {})
      rejectPromise(error)
    }
    function timeoutFailure(exitDetail = '') {
      const timeoutError = new Error(
        `${label} timed out after ${timeoutMs}ms${exitDetail}`,
      )
      return killError
        ? new AggregateError([killError, timeoutError], `${label} hard kill failed`)
        : timeoutError
    }
    function onExit(code, signal) {
      if (timedOut) {
        rejectOnce(timeoutFailure(`; exit observed as ${String(code)}/${String(signal)}`))
        return
      }
      resolveOnce({ code, signal, processId: child.pid })
    }
    function onError(error) {
      rejectOnce(error)
    }

    child.once('exit', onExit)
    child.once('error', onError)
    if ((child.exitCode !== null && child.exitCode !== undefined) || child.signalCode != null) {
      onExit(child.exitCode, child.signalCode ?? null)
      return
    }
    timeoutHandle = setTimeout(() => {
      timedOut = true
      try {
        if (child.kill('SIGKILL') === false) {
          killError = new Error(`${label} refused SIGKILL`)
        }
      } catch (error) {
        killError = error
      }
      killGraceHandle = setTimeout(() => {
        const noExitError = new Error(
          `${label} did not exit within ${killGraceMs}ms after hard kill`,
        )
        rejectOnce(killError
          ? new AggregateError([killError, noExitError], `${label} hard kill failed`)
          : noExitError)
      }, killGraceMs)
    }, timeoutMs)
  })
}

export async function runWithCleanupPreservingErrors(run, cleanup, message) {
  let value
  let primaryError = null
  let cleanupError = null
  try {
    value = await run()
  } catch (error) {
    primaryError = error
  }
  try {
    await cleanup()
  } catch (error) {
    cleanupError = error
  }
  if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], message)
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return value
}

export async function spawnBounded(file, args, {
  cwd = root,
  env = process.env,
  timeoutMs = 120_000,
  killGraceMs = 10_000,
  stdio = ['ignore', 'pipe', 'pipe'],
  onSpawn,
} = {}) {
  const child = spawn(file, args, { cwd, env, stdio, windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  onSpawn?.(child)
  const result = await waitForSpawnedChildExitBounded(child, {
    timeoutMs,
    killGraceMs,
    label: `Command ${file}`,
  })
  if (result.code !== 0) {
    throw new Error(`Command failed (${String(result.code)}/${String(result.signal)}): ${file}\n${stderr}`)
  }
  return { ...result, stdout, stderr }
}

function exactMacPayloadPaths(containerRoot) {
  const application = path.join(containerRoot, 'Trader Atlas.app')
  return {
    application,
    executablePath: path.join(application, 'Contents', 'MacOS', 'Trader Atlas'),
    appAsarPath: path.join(application, 'Contents', 'Resources', 'app.asar'),
  }
}

async function materializeFinalArtifact(options, temporaryRoot, state, trackedProcesses) {
  const { artifactPath, platform } = options
  if (!fs.existsSync(artifactPath) || fs.statSync(artifactPath).size <= 0) {
    throw new Error(`Final packaged artifact is missing or empty: ${artifactPath}`)
  }
  if (platform === 'win32') {
    const installRoot = path.join(temporaryRoot, 'installed')
    fs.mkdirSync(installRoot, { recursive: true })
    Object.assign(state, {
      installAttempted: true,
      artifactFormat: 'nsis',
      materializedRoot: installRoot,
      executablePath: path.join(installRoot, 'Trader Atlas.exe'),
      appAsarPath: path.join(installRoot, 'resources', 'app.asar'),
    })
    // Assisted NSIS reuses a discovered per-machine install mode before applying /D.
    // Force the isolated current-user branch so an existing machine-wide installation
    // cannot trigger UAC, redirect this smoke, or wait on the user's running app.
    // /D must remain the final unquoted argument per the NSIS command-line contract.
    await spawnBounded(artifactPath, ['/S', '/currentuser', `/D=${installRoot}`], {
      cwd: path.dirname(artifactPath),
      timeoutMs: 180_000,
      onSpawn: (child) => {
        if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
      },
    })
    const uninstaller = fs.readdirSync(installRoot)
      .find((name) => /^Uninstall.*\.exe$/i.test(name))
    if (!uninstaller || !fs.existsSync(state.executablePath) || !fs.existsSync(state.appAsarPath)) {
      throw new Error('NSIS did not materialize the exact installed executable, app.asar, and uninstaller')
    }
    state.uninstallerPath = path.join(installRoot, uninstaller)
    return
  }

  if (options.architecture !== process.arch) {
    throw new Error(`macOS final artifact must run natively: requested ${options.architecture}, host ${process.arch}`)
  }
  if (artifactPath.toLowerCase().endsWith('.dmg')) {
    const mountRoot = path.join(temporaryRoot, 'mounted-dmg')
    fs.mkdirSync(mountRoot, { recursive: true })
    await spawnBounded('hdiutil', [
      'attach', '-readonly', '-nobrowse', '-noautoopen', artifactPath, '-mountpoint', mountRoot,
    ], {
      timeoutMs: 120_000,
      onSpawn: (child) => {
        if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
      },
    })
    state.volumeAttached = true
    Object.assign(state, {
      artifactFormat: 'dmg',
      materializedRoot: mountRoot,
      mountRoot,
      ...exactMacPayloadPaths(mountRoot),
    })
  } else {
    const extractionRoot = path.join(temporaryRoot, 'extracted-zip')
    fs.mkdirSync(extractionRoot, { recursive: true })
    await spawnBounded('ditto', ['-x', '-k', artifactPath, extractionRoot], {
      timeoutMs: 120_000,
      onSpawn: (child) => {
        if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
      },
    })
    Object.assign(state, {
      artifactFormat: 'zip',
      materializedRoot: extractionRoot,
      ...exactMacPayloadPaths(extractionRoot),
    })
  }
  if (!fs.existsSync(state.executablePath) || !fs.existsSync(state.appAsarPath)) {
    throw new Error('macOS artifact did not contain the exact Trader Atlas.app payload')
  }
}

async function runPackagedQaMode(executablePath, mode, libraryRoot, trackedProcesses, onSpawn) {
  const messages = []
  const environment = {
    ...process.env,
    TRADER_ATLAS_FORCED_KILL_MODE: mode,
    TRADER_ATLAS_LIBRARY: libraryRoot,
    VITE_DEV_SERVER_URL: '',
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(executablePath, [], {
    cwd: path.dirname(executablePath),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('message', (message) => messages.push(message))
  onSpawn?.(child, messages)
  const result = await waitForSpawnedChildExitBounded(child, {
    timeoutMs: 45_000,
    killGraceMs: 10_000,
    label: `Packaged QA mode ${mode}`,
  })
  return { ...result, messages, stderr }
}

async function rewriteLibraryAsV11(libraryRoot) {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file),
  })
  const databaseFile = path.join(libraryRoot, 'journal.db')
  const database = new SQL.Database(fs.readFileSync(databaseFile))
  try {
    const rows = database.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const snapshot = JSON.parse(String(rows[0]?.values[0]?.[0]))
    delete snapshot.liveStages
    delete snapshot.currentLiveStageId
    delete snapshot.scheduledStageRollover
    for (const trade of snapshot.trades ?? []) delete trade.liveStageId
    for (const review of snapshot.weeklyReviews ?? []) delete review.liveStageId
    for (const field of [
      'weeklyRiskPreparations',
      'riskPolicyVersions',
      'monthlyRiskLimits',
      'riskOverrideEvents',
    ]) {
      for (const entity of snapshot[field] ?? []) delete entity.liveStageId
    }
    const legacyBoundaryKey = ['liveStatsStart', 'TradingDayKey'].join('')
    const legacyCyclesKey = ['livePerformance', 'Cycles'].join('')
    snapshot[legacyBoundaryKey] = '2026-07-01'
    snapshot[legacyCyclesKey] = [{
      id: 'final-artifact-legacy-cycle',
      name: '最终产物迁移阶段',
      startTradingDayKey: '2026-07-01',
      createdAt: '2026-07-01T00:00:00.000Z',
    }]
    database.run(
      "INSERT INTO meta (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(snapshot)],
    )
    database.run(
      "INSERT INTO meta (key, value) VALUES ('schemaVersion', '11') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    fs.writeFileSync(databaseFile, Buffer.from(database.export()))
  } finally {
    database.close()
  }
  const manifestFile = path.join(libraryRoot, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  fs.writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, schemaVersion: 11 }, null, 2)}\n`, 'utf8')
}

async function runV11Migration(executablePath, libraryRoot, trackedProcesses, expectedMainIdentity) {
  const seeded = await runPackagedQaMode(executablePath, 'seed', libraryRoot, trackedProcesses)
  const seededMessage = seeded.messages.find((message) => message?.type === 'seeded')
  if (seeded.code !== 0 || !seededMessage) throw new Error(`Packaged v11 seed failed: ${seeded.stderr}`)
  await rewriteLibraryAsV11(libraryRoot)
  const verifiedRun = await runPackagedQaMode(executablePath, 'verify', libraryRoot, trackedProcesses)
  const verified = verifiedRun.messages.find((message) => message?.type === 'verified')
  if (verifiedRun.code !== 0 || !verified ||
      JSON.stringify(verified.buildIdentity) !== JSON.stringify(expectedMainIdentity)) {
    throw new Error(`Installed payload could not migrate and reopen v11: ${verifiedRun.stderr}`)
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(libraryRoot, 'manifest.json'), 'utf8'))
  const residueAbsent = !fs.existsSync(path.join(libraryRoot, 'v8-to-v9.migration')) &&
    !fs.existsSync(path.join(libraryRoot, '.v8-to-v9-recovery'))
  if (manifest.schemaVersion !== SCHEMA_VERSION || !residueAbsent || verified.liveStageIds?.length !== 1 ||
      !verified.currentTradeIds?.includes('trade-contract')) {
    throw new Error(`Installed payload v11 migration did not produce canonical v12 stage ownership: ${JSON.stringify({
      manifestSchemaVersion: manifest.schemaVersion,
      residueAbsent,
      liveStageIds: verified.liveStageIds,
      currentTradeIds: verified.currentTradeIds,
      archiveTradeIds: verified.archiveTradeIds,
    })}`)
  }
  return {
    seededProcessId: seeded.processId,
    verifiedProcessId: verifiedRun.processId,
    liveStageIds: verified.liveStageIds,
    currentTradeIds: verified.currentTradeIds,
    archiveTradeIds: verified.archiveTradeIds,
    manifestSchemaVersion: manifest.schemaVersion,
    residueAbsent,
  }
}

async function runForcedKillRecovery(executablePath, libraryRoot, trackedProcesses, expectedMainIdentity) {
  const seed = await runPackagedQaMode(executablePath, 'seed', libraryRoot, trackedProcesses)
  const seeded = seed.messages.find((message) => message?.type === 'seeded')
  if (seed.code !== 0 || !seeded) throw new Error(`Packaged forced-kill seed failed: ${seed.stderr}`)

  let temporaryFile = null
  let killed = false
  const watcher = fs.watch(libraryRoot, (_event, fileName) => {
    const name = fileName?.toString() ?? ''
    if (/^\.journal\.db\..+\.tmp$/.test(name)) temporaryFile = name
  })
  let crash
  try {
    crash = await runPackagedQaMode(
      executablePath,
      'crash-save',
      libraryRoot,
      trackedProcesses,
      (child) => {
        const poll = setInterval(() => {
          if (!temporaryFile || child.exitCode !== null) return
          clearInterval(poll)
          killed = child.kill('SIGKILL')
        }, 1)
        child.once('exit', () => clearInterval(poll))
      },
    )
  } finally {
    watcher.close()
  }
  if (!temporaryFile || !killed || crash.code !== null || crash.signal !== 'SIGKILL' ||
      crash.messages.some((message) => message?.type === 'save-completed')) {
    throw new Error('Installed payload forced kill did not occur at the atomic temporary-file boundary')
  }

  const verifyRun = await runPackagedQaMode(executablePath, 'verify', libraryRoot, trackedProcesses)
  const verified = verifyRun.messages.find((message) => message?.type === 'verified')
  if (verifyRun.code !== 0 || !verified || verified.displayName !== 'confirmed-revision-1' ||
      verified.snapshotRevision !== seeded.snapshotRevision ||
      JSON.stringify(verified.buildIdentity) !== JSON.stringify(expectedMainIdentity)) {
    throw new Error(`Installed payload forced-kill recovery failed: ${verifyRun.stderr}`)
  }
  return {
    seedProcessId: seed.processId,
    crashProcessId: crash.processId,
    verifyProcessId: verifyRun.processId,
    temporaryFile,
    signal: crash.signal,
    recoveredSnapshotRevision: verified.snapshotRevision,
  }
}

function canonicalPath(filePath) {
  const canonical = fs.realpathSync.native(filePath)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function assertRuntimeUsesFinalPayload(runtime, executablePath, appAsarPath, expectedArchitecture) {
  if (!runtime.isPackaged || runtime.architecture !== expectedArchitecture ||
      canonicalPath(runtime.actualExecutable) !== canonicalPath(executablePath) ||
      canonicalPath(runtime.actualAppPath) !== canonicalPath(appAsarPath)) {
    throw new Error(`Runtime path is not bound to the materialized final payload: ${JSON.stringify(runtime)}`)
  }
}

async function collectFinalPayloadIdentity({
  executablePath,
  appAsarPath,
  identityLibrary,
  userDataPath,
  expectation,
  expectedArchitecture,
  trackedProcesses,
}) {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`],
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      TRADER_ATLAS_LIBRARY: identityLibrary,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  })
  const launcherProcessId = application.process()?.pid
  if (Number.isSafeInteger(launcherProcessId)) trackedProcesses.add(launcherProcessId)
  let mainProcessId = null
  let closed = false
  return runWithCleanupPreservingErrors(async () => {
    mainProcessId = await application.evaluate(() => process.pid)
    trackedProcesses.add(mainProcessId)
    const page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    const identityEvidence = await collectElectronBundleIdentity({ page, application, expectation })
    const runtime = await application.evaluate(({ app }) => ({
      mainProcessId: process.pid,
      architecture: process.arch,
      isPackaged: app.isPackaged,
      actualExecutable: app.getPath('exe'),
      actualAppPath: app.getAppPath(),
    }))
    assertRuntimeUsesFinalPayload(runtime, executablePath, appAsarPath, expectedArchitecture)
    const closeResult = await closeElectronApplicationBounded(application, {
      mainProcessId,
      timeoutMs: 20_000,
    })
    closed = true
    return { identityEvidence, runtime, closeResult, launcherProcessId, mainProcessId }
  }, async () => {
    if (!closed) {
      await closeElectronApplicationBounded(application, { mainProcessId, timeoutMs: 20_000 })
    }
  }, 'Final payload identity probe failed and Electron cleanup also failed')
}

async function runBridgeScenarios({
  executablePath,
  appAsarPath,
  migrationLibrary,
  switchLibrary,
  invalidLibrary,
  userDataPath,
  expectation,
  expectedArchitecture,
  trackedProcesses,
}) {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`],
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      TRADER_ATLAS_LIBRARY: migrationLibrary,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  })
  const launcherProcessId = application.process()?.pid
  if (Number.isSafeInteger(launcherProcessId)) trackedProcesses.add(launcherProcessId)
  const mainProcessId = await application.evaluate(() => process.pid)
  trackedProcesses.add(mainProcessId)
  let closed = false
  return runWithCleanupPreservingErrors(async () => {
    const page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.journalBridge), null, { timeout: 30_000 })
    // The preload bridge is available before renderer storage hydration finishes.
    // Starting direct bridge scenarios earlier can let the late hydration state
    // persist into a newly activated library and make the release smoke race.
    await page.waitForFunction(
      () => document.documentElement.dataset.uiSettled === '1',
      null,
      { timeout: 30_000 },
    )
    // uiSettled 只表示首屏水合与绘制完成；启动归一化仍可能留下一个 400ms
    // 的防抖保存。直接调用资料库 IPC 前必须让该保存落盘，否则它会在阶段切换
    // 或资料库切换之后用旧的 renderer 快照回写，造成伪造的 stale/回滚失败。
    await page.waitForTimeout(1_200)
    const identityEvidence = await collectElectronBundleIdentity({ page, application, expectation })
    const runtime = await application.evaluate(({ app }) => ({
      mainProcessId: process.pid,
      architecture: process.arch,
      isPackaged: app.isPackaged,
      actualExecutable: app.getPath('exe'),
      actualAppPath: app.getAppPath(),
    }))
    assertRuntimeUsesFinalPayload(runtime, executablePath, appAsarPath, expectedArchitecture)

    const rollover = await page.evaluate(async () => {
      const snapshot = await window.journalBridge.loadSnapshot()
      if (!snapshot) throw new Error('v11 migrated snapshot is missing')
      const expectedRollover = {
        id: 'final-artifact-due-rollover',
        requestedAt: '2026-07-19T08:00:00.000Z',
        effectiveWeekStart: '2026-07-20',
        postponedCount: 0,
      }
      snapshot.scheduledStageRollover = expectedRollover
      const saved = await window.journalBridge.saveSnapshot(snapshot)
      if (!saved) throw new Error('unable to persist due rollover fixture')
      const result = await window.journalBridge.commitStageRollover({
        expectedCurrentStageId: snapshot.currentLiveStageId,
        expectedRollover,
      })
      const authoritative = await window.journalBridge.loadSnapshot()
      const backups = await window.journalBridge.listBackups()
      const backupVerification = backups[0]
        ? await window.journalBridge.verifyBackup(backups[0].name)
        : null
      return { result, authoritative, backups, backupVerification }
    })
    if (!rollover.result?.ok || rollover.authoritative?.scheduledStageRollover !== null ||
        rollover.authoritative?.liveStages?.length !== 2 ||
        rollover.authoritative?.currentLiveStageId !== rollover.result.publish.currentLiveStageId ||
        rollover.backupVerification?.status !== 'verified') {
      throw new Error(`Installed payload due rollover failed: ${JSON.stringify(rollover)}`)
    }
    const rolloverStageId = rollover.authoritative.currentLiveStageId

    const switchFixture = createDesktopVisualSnapshot()
    switchFixture.profile = { ...switchFixture.profile, displayName: 'final-artifact-switch-target' }
    const librarySwitch = await page.evaluate(async ({ targetPath, originalPath, fixture, expectedStageId }) => {
      const create = await window.journalBridge.prepareLibrarySwitch(targetPath, 'create')
      if (!create.ok) return { create }
      const activatedTarget = await window.journalBridge.activatePreparedLibrary(create.token)
      if (!activatedTarget.ok) return { create, activatedTarget }
      const imported = await window.journalBridge.commitImport(fixture, [], { pruneUnreferenced: true })
      const openOriginal = await window.journalBridge.prepareLibrarySwitch(originalPath, 'open')
      if (!openOriginal.ok) return { create, activatedTarget, imported, openOriginal }
      const activatedOriginal = await window.journalBridge.activatePreparedLibrary(openOriginal.token)
      const originalSnapshot = await window.journalBridge.loadSnapshot()
      const reopenTarget = await window.journalBridge.prepareLibrarySwitch(targetPath, 'open')
      if (!reopenTarget.ok) return { activatedOriginal, originalSnapshot, reopenTarget }
      const reactivatedTarget = await window.journalBridge.activatePreparedLibrary(reopenTarget.token)
      const targetSnapshot = await window.journalBridge.loadSnapshot()
      return {
        create,
        activatedTarget,
        imported,
        activatedOriginal,
        originalStageMatches: originalSnapshot?.currentLiveStageId === expectedStageId,
        reactivatedTarget,
        targetDisplayName: targetSnapshot?.profile?.displayName,
        activePath: await window.journalBridge.getLibraryPath(),
      }
    }, {
      targetPath: switchLibrary,
      originalPath: migrationLibrary,
      fixture: switchFixture,
      expectedStageId: rolloverStageId,
    })
    if (!librarySwitch.create?.ok || !librarySwitch.activatedTarget?.ok || librarySwitch.imported !== true ||
        !librarySwitch.activatedOriginal?.ok || librarySwitch.originalStageMatches !== true ||
        !librarySwitch.reactivatedTarget?.ok ||
        librarySwitch.targetDisplayName !== 'final-artifact-switch-target' ||
        path.resolve(librarySwitch.activePath) !== path.resolve(switchLibrary)) {
      throw new Error(`Installed payload library switch failed: ${JSON.stringify(librarySwitch)}`)
    }

    const asset = await page.evaluate(async () => {
      const expected = [11, 22, 33, 44, 55]
      const id = await window.journalBridge.saveAsset(Uint8Array.from(expected).buffer, 'image/png')
      const loaded = await window.journalBridge.getAssetBytes(id)
      const stats = await window.journalBridge.getAssetStats([id])
      return {
        id,
        bytes: loaded ? [...loaded.bytes] : null,
        mime: loaded?.mime ?? null,
        stats,
      }
    })
    if (!asset.id || JSON.stringify(asset.bytes) !== JSON.stringify([11, 22, 33, 44, 55]) ||
        asset.mime !== 'image/png' || asset.stats?.count !== 1 || asset.stats?.missingCount !== 0) {
      throw new Error(`Installed payload asset roundtrip failed: ${JSON.stringify(asset)}`)
    }

    fs.mkdirSync(invalidLibrary, { recursive: true })
    fs.writeFileSync(path.join(invalidLibrary, 'manifest.json'), '{"schemaVersion":12}\n', 'utf8')
    const safety = await page.evaluate(async (badPath) => {
      const beforePath = await window.journalBridge.getLibraryPath()
      const before = await window.journalBridge.loadSnapshot()
      const prepared = await window.journalBridge.prepareLibrarySwitch(badPath, 'open')
      const afterPath = await window.journalBridge.getLibraryPath()
      const after = await window.journalBridge.loadSnapshot()
      return {
        prepared,
        beforePath,
        afterPath,
        beforeStage: before?.currentLiveStageId,
        afterStage: after?.currentLiveStageId,
      }
    }, invalidLibrary)
    if (safety.prepared?.ok !== false || safety.beforePath !== safety.afterPath ||
        safety.beforeStage !== safety.afterStage || fs.existsSync(path.join(invalidLibrary, 'journal.db'))) {
      throw new Error(`Installed payload invalid-library safety failed: ${JSON.stringify(safety)}`)
    }

    const closeResult = await closeElectronApplicationBounded(application, {
      mainProcessId,
      timeoutMs: 20_000,
    })
    closed = true
    return {
      application: null,
      identityEvidence,
      runtime,
      launcherProcessId,
      mainProcessId,
      closeResult,
      rollover: {
        currentStageId: rolloverStageId,
        stageCount: rollover.authoritative.liveStages.length,
        backupStatus: rollover.backupVerification.status,
      },
      librarySwitch,
      asset,
      safety,
    }
  }, async () => {
    if (!closed) {
      await closeElectronApplicationBounded(application, { mainProcessId, timeoutMs: 20_000 })
    }
  }, 'Final artifact bridge scenarios failed and Electron cleanup also failed')
}

async function terminateTrackedProcessesBounded(trackedProcesses, timeoutMs = 20_000) {
  const killErrors = []
  for (const processId of trackedProcesses) {
    if (!processExists(processId)) continue
    try {
      process.kill(processId, 'SIGKILL')
    } catch (error) {
      try {
        if (processExists(processId)) killErrors.push(error)
      } catch (existenceError) {
        killErrors.push(new AggregateError([error, existenceError], `Unable to inspect process ${processId}`))
      }
    }
  }
  await waitUntil(
    () => [...trackedProcesses].every((processId) => !processExists(processId)),
    timeoutMs,
    'Final packaged smoke left a process residue',
  )
  if (killErrors.length === 1) throw killErrors[0]
  if (killErrors.length > 1) throw new AggregateError(killErrors, 'Final packaged process cleanup failed')
}

async function cleanupMaterializedPayload(options, temporaryRoot, state, trackedProcesses) {
  const errors = []
  let installerUninstalled = false
  let volumeDetached = false
  let detachForced = false
  if (options.platform === 'win32' && state.installAttempted) {
    try {
      if (!state.uninstallerPath && fs.existsSync(state.materializedRoot)) {
        const name = fs.readdirSync(state.materializedRoot).find((entry) => /^Uninstall.*\.exe$/i.test(entry))
        if (name) state.uninstallerPath = path.join(state.materializedRoot, name)
      }
      if (!state.uninstallerPath || !fs.existsSync(state.uninstallerPath)) {
        throw new Error('Installed NSIS payload is missing its uninstaller')
      }
      // Both HKLM and this temporary HKCU install can exist. Pin cleanup to the
      // current-user branch so it can never select the user's machine-wide app.
      await spawnBounded(state.uninstallerPath, ['/S', '/currentuser'], {
        cwd: state.materializedRoot,
        timeoutMs: 120_000,
        onSpawn: (child) => {
          if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
        },
      })
      await waitUntil(
        () => !fs.existsSync(state.executablePath),
        30_000,
        'NSIS uninstaller did not remove the installed executable',
      )
      installerUninstalled = true
    } catch (error) {
      errors.push(error)
    }
  }
  if (options.platform === 'darwin' && state.volumeAttached) {
    try {
      try {
        await spawnBounded('hdiutil', ['detach', state.mountRoot], {
          timeoutMs: 60_000,
          onSpawn: (child) => {
            if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
          },
        })
      } catch {
        detachForced = true
        await spawnBounded('hdiutil', ['detach', '-force', state.mountRoot], {
          timeoutMs: 60_000,
          onSpawn: (child) => {
            if (Number.isSafeInteger(child.pid)) trackedProcesses.add(child.pid)
          },
        })
      }
      volumeDetached = true
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    await removeTemporaryDirectoryBounded(temporaryRoot, { timeoutMs: 30_000 })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Final artifact materialization cleanup failed')
  return { installerUninstalled, volumeDetached, detachForced }
}

function writeReportAtomically(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, outputPath)
}

export async function runFinalPackagedArtifactSmoke(argv = process.argv.slice(2)) {
  const options = parseFinalPackagedArtifactArgs(argv)
  fs.rmSync(options.outputPath, { force: true })
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-atlas-final-artifact-'))
  const state = {
    installAttempted: false,
    volumeAttached: false,
    executablePath: null,
    appAsarPath: null,
  }
  const trackedProcesses = new Set()
  const scenarioEvidence = {}
  let identityEvidence = null
  let runtime = null
  let primaryError = null
  let cleanupError = null
  let cleanupPlatform = {
    installerUninstalled: false,
    volumeDetached: false,
    detachForced: false,
  }
  let payload = null

  try {
    await materializeFinalArtifact(options, temporaryRoot, state, trackedProcesses)
    payload = {
      artifact: payloadHash(options.artifactPath),
      executable: payloadHash(state.executablePath),
      appAsar: payloadHash(state.appAsarPath),
    }
    const expectation = await readRepositoryBuildExpectation(root)
    const migrationLibrary = path.join(temporaryRoot, 'migration-library')
    const switchLibrary = path.join(temporaryRoot, 'switch-library')
    const invalidLibrary = path.join(temporaryRoot, 'invalid-library')
    const userDataPath = path.join(temporaryRoot, 'user-data')
    const identityUserDataPath = path.join(temporaryRoot, 'identity-user-data')
    const identityLibrary = path.join(temporaryRoot, 'identity-library')
    const forcedKillLibrary = path.join(temporaryRoot, 'forced-kill-library')
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.mkdirSync(identityUserDataPath, { recursive: true })
    fs.mkdirSync(identityLibrary, { recursive: true })

    const initialIdentity = await runPackagedQaMode(
      state.executablePath,
      'identity',
      path.join(temporaryRoot, 'identity-probe'),
      trackedProcesses,
    )
    const mainIdentity = initialIdentity.messages.find((message) => message?.type === 'identity')?.buildIdentity
    if (initialIdentity.code !== 0 || !mainIdentity) {
      throw new Error(`Unable to read installed main identity: ${initialIdentity.stderr}`)
    }
    validateBundleBuildIdentityEvidence({
      bundles: { main: mainIdentity },
      repository: expectation.repository,
      ci: expectation.ci,
    }, ['main'])
    const identityProbe = await collectFinalPayloadIdentity({
      executablePath: state.executablePath,
      appAsarPath: state.appAsarPath,
      identityLibrary,
      userDataPath: identityUserDataPath,
      expectation,
      expectedArchitecture: options.architecture,
      trackedProcesses,
    })
    if (JSON.stringify(identityProbe.identityEvidence.bundles.main) !== JSON.stringify(mainIdentity)) {
      throw new Error('Final payload identity probe main does not match forced-kill main identity')
    }
    identityEvidence = identityProbe.identityEvidence
    runtime = identityProbe.runtime
    scenarioEvidence.identityProbeCleanup = identityProbe.closeResult
    scenarioEvidence.migration = await runV11Migration(
      state.executablePath,
      migrationLibrary,
      trackedProcesses,
      mainIdentity,
    )
    const bridge = await runBridgeScenarios({
      executablePath: state.executablePath,
      appAsarPath: state.appAsarPath,
      migrationLibrary,
      switchLibrary,
      invalidLibrary,
      userDataPath,
      expectation,
      expectedArchitecture: options.architecture,
      trackedProcesses,
    })
    identityEvidence = bridge.identityEvidence
    runtime = bridge.runtime
    if (JSON.stringify(identityEvidence.bundles.main) !== JSON.stringify(mainIdentity)) {
      throw new Error('Forced-kill main identity does not match the visual main identity')
    }
    scenarioEvidence.rollover = bridge.rollover
    scenarioEvidence.librarySwitch = bridge.librarySwitch
    scenarioEvidence.asset = bridge.asset
    scenarioEvidence.safety = bridge.safety
    scenarioEvidence.bridgeCleanup = bridge.closeResult
    scenarioEvidence.forcedKill = await runForcedKillRecovery(
      state.executablePath,
      forcedKillLibrary,
      trackedProcesses,
      mainIdentity,
    )
  } catch (error) {
    primaryError = error
  } finally {
    const cleanupErrors = []
    try {
      await terminateTrackedProcessesBounded(trackedProcesses)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      cleanupPlatform = await cleanupMaterializedPayload(options, temporaryRoot, state, trackedProcesses)
    } catch (error) {
      cleanupErrors.push(error)
    }
    // Installer/uninstaller/hdiutil/ditto processes are tracked too; always recheck commands
    // created during materialization cleanup before a PASS report can be assembled.
    try {
      await terminateTrackedProcessesBounded(trackedProcesses)
    } catch (error) {
      cleanupErrors.push(error)
    }
    cleanupError = cleanupErrors.length === 0
      ? null
      : cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, 'Final artifact cleanup had multiple failures')
  }

  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'Final artifact smoke failed and cleanup also failed')
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError

  const processIds = [...trackedProcesses]
  const cleanup = {
    processIds,
    allProcessesExited: processIds.length > 0 && processIds.every((processId) => !processExists(processId)),
    temporaryRootDeleted: !fs.existsSync(temporaryRoot),
    materializedPayloadRemoved: !fs.existsSync(state.executablePath),
    ...cleanupPlatform,
  }
  const scenarios = [
    { id: 'identity', pass: Boolean(identityEvidence), detail: runtime },
    { id: 'v11-migration', pass: scenarioEvidence.migration?.manifestSchemaVersion === SCHEMA_VERSION, detail: scenarioEvidence.migration },
    { id: 'due-stage-rollover', pass: scenarioEvidence.rollover?.stageCount === 2, detail: scenarioEvidence.rollover },
    { id: 'library-switch', pass: scenarioEvidence.librarySwitch?.originalStageMatches === true, detail: scenarioEvidence.librarySwitch },
    { id: 'forced-kill-recovery', pass: scenarioEvidence.forcedKill?.signal === 'SIGKILL', detail: scenarioEvidence.forcedKill },
    { id: 'asset-roundtrip', pass: scenarioEvidence.asset?.stats?.count === 1, detail: scenarioEvidence.asset },
    { id: 'invalid-library-fail-closed', pass: scenarioEvidence.safety?.prepared?.ok === false, detail: scenarioEvidence.safety },
  ]
  const report = {
    schemaVersion: 1,
    runtime: 'final-packaged-artifact',
    generatedAt: new Date().toISOString(),
    platform: options.platform,
    architecture: options.architecture,
    artifactFormat: state.artifactFormat,
    ...identityEvidence,
    payload,
    runtimeEvidence: runtime,
    scenarios,
    cleanup,
  }
  validateFinalPackagedArtifactReport(report)
  writeReportAtomically(options.outputPath, report)
  process.stdout.write(`final packaged artifact smoke: PASS (${options.outputPath})\n`)
  return report
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await runFinalPackagedArtifactSmoke()
