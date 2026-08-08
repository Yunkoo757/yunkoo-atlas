import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'

import { SCHEMA_VERSION } from '../src/storage/types.ts'
import { readGitProvenance } from './git-provenance.mjs'
import { detectFileSystem } from './file-system-type.mjs'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null
const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-forced-kill-library-'))

function runElectronMain(mode, onSpawn, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TRADER_ATLAS_FORCED_KILL_MODE: mode,
      TRADER_ATLAS_LIBRARY: libraryRoot,
      VITE_DEV_SERVER_URL: '',
      ...extraEnv,
    }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electronExecutable, ['.'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env,
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    const messages = []
    child.on('message', (message) => {
      messages.push(message)
      if (message?.type === 'error') reject(new Error(message.message))
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({ code, signal, messages, stderr, pid: child.pid }))
    onSpawn?.(child, messages)
  })
}

async function rewriteLibraryAsV8() {
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

function readMigrationPhase() {
  try {
    return JSON.parse(fs.readFileSync(path.join(libraryRoot, 'v8-to-v9.migration'), 'utf8')).phase
  } catch {
    return null
  }
}

async function forceKillMigrationAt(boundary) {
  await rewriteLibraryAsV8()
  let killSignalSent = false
  let boundaryObserved = false
  const run = runElectronMain('verify', (child) => {
    const poll = setInterval(() => {
      const phase = readMigrationPhase()
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
  }, { ATLAS_SCHEMA_MIGRATION_PAUSE_BOUNDARY: boundary })
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${boundary} 迁移边界超时`)), 30_000)
    run.finally(() => clearTimeout(timer)).catch(() => {})
  })
  const crashed = await Promise.race([run, timeout])
  if (!boundaryObserved || !killSignalSent || crashed.signal !== 'SIGKILL' || crashed.code !== null) {
    throw new Error(`未能在 ${boundary} 真实强杀 Electron 主进程`)
  }
  const reopened = await runElectronMain('verify')
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

try {
  if (!fs.existsSync(path.join(root, 'dist-electron', 'main.js'))) {
    throw new Error('缺少 dist-electron/main.js；请先运行 pnpm build:app')
  }
  const seed = await runElectronMain('seed')
  if (seed.code !== 0 || !seed.messages.some((message) => message?.type === 'seeded')) {
    throw new Error(`无法建立最后确认 revision：${seed.stderr}`)
  }

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
  const crashPromise = runElectronMain('crash-save', (child) => {
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
  })
  const crashTimeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('等待原子临时文件或强杀退出超时')), 30_000)
    crashPromise.finally(() => clearTimeout(timer)).catch(() => {})
  })
  const crash = await Promise.race([crashPromise, crashTimeout])
  watcher.close()
  if (!saveStartingObserved || !tempFileObserved || !killRequestedAt || !killSignalSent) {
    throw new Error('没有证明强杀发生在保存的原子临时文件阶段')
  }
  if (crash.signal !== 'SIGKILL' || crash.code !== null) {
    throw new Error(`子进程没有以 SIGKILL 终止：code=${crash.code} signal=${crash.signal}`)
  }
  if (crash.messages.some((message) => message?.type === 'save-completed')) {
    throw new Error('强杀前保存已经完成，证据无效')
  }

  const verify = await runElectronMain('verify')
  const verified = verify.messages.find((message) => message?.type === 'verified')
  if (verify.code !== 0 || !verified) throw new Error(`强杀后无法重新打开资料库：${verify.stderr}`)
  const lastConfirmedRecovered = verified.displayName === 'confirmed-revision-1'
  const unconfirmedAbsent = verified.displayName !== 'unconfirmed-revision-2'
  const schemaMigration = []
  for (const boundary of [
    'before-database-replace',
    'after-database-replace',
    'after-manifest-replace',
  ]) {
    schemaMigration.push(await forceKillMigrationAt(boundary))
  }
  const schemaMigrationRecovered = schemaMigration.every((result) => result.status === 'pass')
  const provenance = await readGitProvenance(root)
  const fileSystem = detectFileSystem(libraryRoot)
  const report = {
    version: 1,
    scenarioId: 'E-FORCED-KILL',
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    fileSystem,
    gitCommit: provenance.gitCommit,
    gitTree: provenance.gitTree,
    workingTreeDirty: provenance.workingTreeDirty,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceIdentity: provenance.sourceIdentity,
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
    },
    schemaMigration,
    status: saveStartingMessage?.runtime === 'electron-main' &&
      saveStartingMessage?.processId === crash.pid &&
      typeof saveStartingMessage?.electronVersion === 'string' && saveStartingMessage.electronVersion.length > 0 &&
      killSignalSent && crash.signal === 'SIGKILL' && crash.code === null &&
      lastConfirmedRecovered && unconfirmedAbsent && schemaMigrationRecovered ? 'pass' : 'fail',
  }
  const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const outputPath = path.resolve(explicitOutput ?? path.join(
    'test-results',
    'forced-kill',
    `forced-kill-${platformName}-${fileSystem.toLowerCase()}.json`,
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
  if (report.status !== 'pass') process.exitCode = 1
} finally {
  await fs.promises.rm(libraryRoot, { recursive: true, force: true })
}
