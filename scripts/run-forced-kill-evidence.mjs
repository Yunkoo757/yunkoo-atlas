import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import initSqlJs from 'sql.js'

import { SCHEMA_VERSION } from '../src/storage/types.ts'
import { readRepositoryBuildExpectation } from './bundle-build-identity.mjs'
import { runForcedKillEvidenceRunner } from './electron-evidence-runner.mjs'
import { detectFileSystem } from './file-system-type.mjs'
import { runHeadlessElectron } from './headless-electron.mjs'

export { runForcedKillEvidenceRunner } from './electron-evidence-runner.mjs'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null

function runElectronMain(mode, library, { onSpawn, extraEnv, timeoutMs } = {}) {
  return runHeadlessElectron({
    executable: electronExecutable,
    root,
    library,
    environment: { ...extraEnv, TRADER_ATLAS_FORCED_KILL_MODE: mode },
    onSpawn,
    timeoutMs,
  })
}

async function rewriteLibraryAsV8(libraryRoot) {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file),
  })
  const databaseFile = path.join(libraryRoot, 'journal.db')
  const database = new SQL.Database(fs.readFileSync(databaseFile))
  try {
    const rows = database.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const raw = JSON.parse(String(rows[0]?.values[0]?.[0]))
    delete raw.weeklyRiskPreparations
    delete raw.riskPolicyVersions
    delete raw.monthlyRiskLimits
    delete raw.riskOverrideEvents
    for (const trade of raw.trades ?? []) delete trade.closedTradingDayKey
    database.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [JSON.stringify(raw)])
    database.run("DELETE FROM meta WHERE key = 'schemaVersion'")
    fs.writeFileSync(databaseFile, Buffer.from(database.export()))
  } finally {
    database.close()
  }
  const manifestFile = path.join(libraryRoot, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, schemaVersion: 8 }, null, 2), 'utf8')
}

function readMigrationPhase(libraryRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(libraryRoot, 'v8-to-v9.migration'), 'utf8')).phase
  } catch {
    return null
  }
}

async function forceKillMigrationAt(libraryRoot, boundary) {
  await rewriteLibraryAsV8(libraryRoot)
  let killSignalSent = false
  let boundaryObserved = false
  const crashed = await runElectronMain('verify', libraryRoot, {
    timeoutMs: 30_000,
    extraEnv: { ATLAS_SCHEMA_MIGRATION_PAUSE_BOUNDARY: boundary },
    onSpawn(child) {
      const poll = setInterval(() => {
        const phase = readMigrationPhase(libraryRoot)
        const observed = boundary === 'before-database-replace'
          ? phase === 'prepared' && fs.existsSync(path.join(libraryRoot, '.v8-to-v9-journal.db.candidate'))
          : boundary === 'after-database-replace'
            ? phase === 'database-replaced'
            : phase === 'manifest-replaced'
        if (!observed || child.exitCode !== null) return
        clearInterval(poll)
        boundaryObserved = true
        killSignalSent = child.kill('SIGKILL')
      }, 1)
      child.once('exit', () => clearInterval(poll))
    },
  })
  if (!boundaryObserved || !killSignalSent || crashed.signal !== 'SIGKILL' || crashed.code !== null) {
    throw new Error(`未能在 ${boundary} 真实强杀 Electron 主进程`)
  }
  const reopened = await runElectronMain('verify', libraryRoot)
  const verified = reopened.messages.find((message) => message?.type === 'verified')
  const manifest = JSON.parse(fs.readFileSync(path.join(libraryRoot, 'manifest.json'), 'utf8'))
  const markerAbsent = !fs.existsSync(path.join(libraryRoot, 'v8-to-v9.migration'))
  const recoveryAbsent = !fs.existsSync(path.join(libraryRoot, '.v8-to-v9-recovery'))
  const passed = reopened.code === 0 && Boolean(verified) && manifest.schemaVersion === SCHEMA_VERSION &&
    verified.displayName === 'confirmed-revision-1' && markerAbsent && recoveryAbsent
  return {
    boundary,
    boundaryObserved,
    killSignalSent,
    exitCode: crashed.code,
    signal: crashed.signal,
    recoveredSchemaVersion: manifest.schemaVersion,
    recoveredDisplayName: verified?.displayName ?? null,
    markerAbsent,
    recoveryAbsent,
    status: passed ? 'pass' : 'fail',
  }
}

async function readMainBundleIdentity() {
  if (!fs.existsSync(path.join(root, 'dist-electron', 'main.js'))) {
    throw new Error('缺少 dist-electron/main.js；请先运行 pnpm build:app')
  }
  const buildExpectation = await readRepositoryBuildExpectation(root)
  const identityProbePath = path.join(os.tmpdir(), `atlas-forced-kill-identity-probe-${process.pid}`)
  const identityRun = await runElectronMain('identity', identityProbePath)
  const identityMessage = identityRun.messages.find((message) => message?.type === 'identity')
  if (identityRun.code !== 0 || !identityMessage?.buildIdentity) {
    throw new Error(`无法读取实际 Electron main bundle identity：${identityRun.stderr}`)
  }
  return {
    bundles: { main: identityMessage.buildIdentity },
    repository: buildExpectation.repository,
    ci: buildExpectation.ci,
  }
}

async function seedForcedKillLibrary({ library }) {
  const seed = await runElectronMain('seed', library)
  if (seed.code !== 0 || !seed.messages.some((message) => message?.type === 'seeded')) {
    throw new Error(`无法建立最后确认 revision：${seed.stderr}`)
  }
  const seeded = seed.messages.find((message) => message?.type === 'seeded')
  return {
    expectedLiveStageIds: seeded?.liveStageIds ?? [],
    expectedSnapshotRevision: seeded?.snapshotRevision ?? null,
  }
}

async function captureForcedKillEvidence({ bundleIdentity, library: libraryRoot, seed }) {
  const expectedLiveStageIds = seed.expectedLiveStageIds
  const expectedSnapshotRevision = seed.expectedSnapshotRevision
  let tempFileObserved = null
  let killRequestedAt = null
  let saveStartingObserved = false
  let saveStartingMessage = null
  let childPid = null
  let killSignalSent = false
  const watcher = fs.watch(libraryRoot, (eventType, filename) => {
    const name = filename?.toString() ?? ''
    if (!name.startsWith('.journal.db.') || !name.endsWith('.tmp') || childPid === null) return
    tempFileObserved = name
    killRequestedAt = new Date().toISOString()
  })
  const crashPromise = runElectronMain('crash-save', libraryRoot, {
    timeoutMs: 30_000,
    onSpawn(child) {
      childPid = child.pid ?? null
      child.on('message', (message) => {
        if (message?.type === 'save-starting') {
          saveStartingObserved = true
          saveStartingMessage = message
        }
      })
      const poll = setInterval(() => {
        if (!tempFileObserved || child.exitCode !== null) return
        clearInterval(poll)
        killSignalSent = child.kill('SIGKILL')
      }, 1)
      child.once('exit', () => clearInterval(poll))
    },
  })
  let crash
  try {
    crash = await crashPromise
  } finally {
    watcher.close()
  }
  if (!saveStartingObserved || !tempFileObserved || !killRequestedAt || !killSignalSent) {
    throw new Error('没有证明强杀发生在保存的原子临时文件阶段')
  }
  if (crash.signal !== 'SIGKILL' || crash.code !== null) {
    throw new Error(`子进程没有以 SIGKILL 终止：code=${crash.code} signal=${crash.signal}`)
  }
  if (crash.messages.some((message) => message?.type === 'save-completed')) {
    throw new Error('强杀前保存已经完成，证据无效')
  }

  const verify = await runElectronMain('verify', libraryRoot)
  const verified = verify.messages.find((message) => message?.type === 'verified')
  if (verify.code !== 0 || !verified) throw new Error(`强杀后无法重新打开资料库：${verify.stderr}`)
  const lastConfirmedRecovered = verified.displayName === 'confirmed-revision-1'
  const unconfirmedAbsent = verified.displayName !== 'unconfirmed-revision-2'
  const liveStageIdsRecovered = JSON.stringify(verified.liveStageIds) === JSON.stringify(expectedLiveStageIds)
  const currentTradeIdsRecovered = verified.currentTradeIds?.includes('trade-contract') === true
  const archiveTradeIdsRecovered = verified.archiveTradeIds?.includes('trade-archive-contract') === true
  const snapshotRevisionRecovered = verified.snapshotRevision === expectedSnapshotRevision
  const schemaMigration = []
  for (const boundary of [
    'before-database-replace',
    'after-database-replace',
    'after-manifest-replace',
  ]) {
    schemaMigration.push(await forceKillMigrationAt(libraryRoot, boundary))
  }
  const schemaMigrationRecovered = schemaMigration.every((result) => result.status === 'pass')
  const fileSystem = detectFileSystem(libraryRoot)
  const report = {
    version: 1,
    scenarioId: 'E-FORCED-KILL',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    fileSystem,
    gitCommit: bundleIdentity.repository.head,
    gitTree: bundleIdentity.repository.tree,
    workingTreeDirty: bundleIdentity.repository.dirty,
    sourceFingerprint: bundleIdentity.repository.sourceFingerprint,
    sourceIdentity: bundleIdentity.repository.sourceIdentity,
    bundleIdentity,
    process: {
      runtime: saveStartingMessage?.runtime ?? null,
      electronVersion: saveStartingMessage?.electronVersion ?? null,
      childPid: crash.pid,
      mainProcessPid: saveStartingMessage?.processId ?? null,
      exitCode: crash.code,
      signal: crash.signal,
      saveStartingObserved,
      atomicTempFileObserved: tempFileObserved,
      killRequestedAt,
      killSignalSent,
      saveCompletedAcknowledged: false,
    },
    recovery: {
      expected: 'confirmed-revision-1',
      observed: verified.displayName,
      noteLength: verified.noteLength,
      lastConfirmedRecovered,
      unconfirmedMemoryEditPromised: false,
      unconfirmedPendingRevisionAbsent: unconfirmedAbsent,
      snapshotRevision: verified.snapshotRevision,
      expectedSnapshotRevision,
      liveStageIds: verified.liveStageIds,
      expectedLiveStageIds,
      currentTradeIds: verified.currentTradeIds,
      archiveTradeIds: verified.archiveTradeIds,
      liveArchiveScopeRecovered: liveStageIdsRecovered && currentTradeIdsRecovered && archiveTradeIdsRecovered,
      snapshotRevisionRecovered,
    },
    schemaMigration,
    status: saveStartingMessage?.runtime === 'electron-main' &&
      saveStartingMessage?.processId === crash.pid &&
      typeof saveStartingMessage?.electronVersion === 'string' && saveStartingMessage.electronVersion.length > 0 &&
      killSignalSent && crash.signal === 'SIGKILL' && crash.code === null &&
      lastConfirmedRecovered && unconfirmedAbsent && liveStageIdsRecovered &&
      currentTradeIdsRecovered && archiveTradeIdsRecovered && snapshotRevisionRecovered &&
      schemaMigrationRecovered ? 'pass' : 'fail',
  }
  return report
}

async function writeForcedKillReport(report) {
  const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const outputPath = path.resolve(explicitOutput ?? path.join(
    'test-results',
    'forced-kill',
    `forced-kill-${platformName}-${report.fileSystem.toLowerCase()}.json`,
  ))
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    outputPath,
    status: report.status,
    process: report.process,
    recovery: report.recovery,
    schemaMigration: report.schemaMigration,
  }, null, 2))
  return report
}

export async function runForcedKillEvidence() {
  return runForcedKillEvidenceRunner({
    readBundleIdentity: readMainBundleIdentity,
    createLibrary: () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-forced-kill-library-')),
    seedLibrary: seedForcedKillLibrary,
    captureEvidence: captureForcedKillEvidence,
    cleanupEvidence: async library => {
      if (library) await fs.promises.rm(library, { recursive: true, force: true })
    },
    writeReport: writeForcedKillReport,
  })
}

async function main() {
  const report = await runForcedKillEvidence()
  if (report.status !== 'pass') process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()
