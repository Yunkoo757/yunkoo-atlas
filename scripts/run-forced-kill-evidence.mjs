import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const root = process.cwd()
const outputIndex = process.argv.indexOf('--output')
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null
const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-forced-kill-library-'))

function detectFileSystem(directory) {
  if (process.platform === 'win32') {
    const driveLetter = path.parse(path.resolve(directory)).root.slice(0, 1)
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Volume -DriveLetter '${driveLetter}').FileSystem`],
      { encoding: 'utf8' },
    ).trim()
  }
  if (process.platform === 'darwin') {
    return execFileSync('stat', ['-f', '%T', directory], { encoding: 'utf8' }).trim().toUpperCase()
  }
  return execFileSync('stat', ['-f', '-c', '%T', directory], { encoding: 'utf8' }).trim()
}

function runElectronMain(mode, onSpawn) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      LINEAR_JOURNAL_FORCED_KILL_MODE: mode,
      LINEAR_JOURNAL_LIBRARY: libraryRoot,
      VITE_DEV_SERVER_URL: '',
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
    status: saveStartingMessage?.runtime === 'electron-main' &&
      saveStartingMessage?.processId === crash.pid &&
      typeof saveStartingMessage?.electronVersion === 'string' && saveStartingMessage.electronVersion.length > 0 &&
      killSignalSent && crash.signal === 'SIGKILL' && crash.code === null &&
      lastConfirmedRecovered && unconfirmedAbsent ? 'pass' : 'fail',
  }
  const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const outputPath = path.resolve(explicitOutput ?? path.join(
    'test-results',
    'forced-kill',
    `forced-kill-${platformName}-${fileSystem.toLowerCase()}.json`,
  ))
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, status: report.status, process: report.process, recovery: report.recovery }, null, 2))
  if (report.status !== 'pass') process.exitCode = 1
} finally {
  await fs.promises.rm(libraryRoot, { recursive: true, force: true })
}
