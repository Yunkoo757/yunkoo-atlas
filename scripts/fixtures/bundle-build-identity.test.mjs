import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'

import * as bundleBuildIdentity from '../bundle-build-identity.mjs'
import {
  closeElectronApplication,
  collectElectronBundleIdentity,
  readRepositoryBuildExpectation,
  validateBundleBuildIdentityEvidence,
} from '../bundle-build-identity.mjs'

const commitA = 'a'.repeat(40)
const commitB = 'b'.repeat(40)

function expectation(commit = commitA, githubSha = null) {
  return {
    repository: { head: commit, dirty: false },
    ci: { githubSha },
  }
}

function runtime(identity) {
  return { evaluate: async () => identity }
}

test('local build expectation records an absent GITHUB_SHA as explicit null', async () => {
  const evidence = await readRepositoryBuildExpectation(process.cwd(), {})
  assert.equal(evidence.ci.githubSha, null)
})

test('Electron visual rejects a stale renderer or main bundle before evidence collection', async () => {
  await assert.rejects(
    () => collectElectronBundleIdentity({
      page: runtime({ commit: commitA, dirty: false }),
      application: runtime({ commit: commitB, dirty: false }),
      expectation: expectation(),
    }),
    /main bundle commit.*repository HEAD/i,
  )
  await assert.rejects(
    () => collectElectronBundleIdentity({
      page: runtime({ commit: commitB, dirty: false }),
      application: runtime({ commit: commitA, dirty: false }),
      expectation: expectation(),
    }),
    /renderer bundle commit.*repository HEAD/i,
  )
})

test('Electron visual accepts matching clean renderer and main bundle identities', async () => {
  const evidence = await collectElectronBundleIdentity({
    page: runtime({ commit: commitA, dirty: false }),
    application: runtime({ commit: commitA, dirty: false }),
    expectation: expectation(),
  })

  assert.deepEqual(evidence, {
    bundles: {
      renderer: { commit: commitA, dirty: false },
      main: { commit: commitA, dirty: false },
    },
    ...expectation(),
  })
})

test('forced-kill rejects stale or dirty actual main identity and honors exact GITHUB_SHA', () => {
  assert.throws(
    () => validateBundleBuildIdentityEvidence({
      bundles: { main: { commit: commitB, dirty: false } },
      ...expectation(),
    }, ['main']),
    /main bundle commit.*repository HEAD/i,
  )
  assert.throws(
    () => validateBundleBuildIdentityEvidence({
      bundles: { main: { commit: commitA, dirty: true } },
      ...expectation(),
    }, ['main']),
    /main bundle.*dirty/i,
  )
  assert.throws(
    () => validateBundleBuildIdentityEvidence({
      bundles: { main: { commit: commitA, dirty: false } },
      ...expectation(commitA, commitB),
    }, ['main']),
    /repository HEAD.*GITHUB_SHA/i,
  )
  assert.doesNotThrow(() => validateBundleBuildIdentityEvidence({
    bundles: { main: { commit: commitA, dirty: false } },
    ...expectation(commitA, commitA),
  }, ['main']))
})

test('all bundle evidence fails closed when the repository working tree is dirty', () => {
  assert.throws(
    () => validateBundleBuildIdentityEvidence({
      bundles: { renderer: { commit: commitA, dirty: false } },
      repository: { head: commitA, dirty: true },
      ci: { githubSha: null },
    }, ['renderer']),
    /repository working tree.*dirty/i,
  )
})

test('Electron visual identity failure cannot hang while closing the stale application', async () => {
  let killed = false
  let exited = false
  const child = new EventEmitter()
  child.kill = () => {
    killed = true
    return true
  }
  const application = {
    close: async () => new Promise(() => {}),
    evaluate: async () => {
      setTimeout(() => {
        exited = true
        child.emit('exit')
      }, 2)
    },
    process: () => child,
  }

  const result = await closeElectronApplication(application, 5)

  assert.equal(result.forced, true)
  assert.equal(killed, false, 'app.exit should release the process before a hard kill is needed')
  assert.equal(exited, true, 'helper must wait for the exiting process to release its files')
})

test('bounded Electron cleanup continues from close rejection through app exit and PID hard kill', async () => {
  const calls = []
  const child = new EventEmitter()
  child.pid = 4242
  child.exitCode = null
  child.signalCode = null
  const application = {
    close: async () => {
      calls.push('close')
      throw new Error('close rejected')
    },
    evaluate: async () => { calls.push('app-exit') },
    process: () => child,
  }

  assert.equal(typeof bundleBuildIdentity.closeElectronApplicationBounded, 'function')
  const result = await bundleBuildIdentity.closeElectronApplicationBounded(application, {
    timeoutMs: 5,
    mainProcessId: 4342,
    processExists: () => !calls.includes('exit-observed'),
    killProcess: (pid) => {
      calls.push(`kill:${pid}`)
      queueMicrotask(() => {
        calls.push('exit-observed')
        child.signalCode = 'SIGKILL'
        child.emit('exit', null, 'SIGKILL')
      })
    },
  })

  assert.deepEqual(calls, ['close', 'app-exit', 'kill:4342', 'exit-observed'])
  assert.deepEqual(result, { forced: true, hardKilled: true, exitObserved: true })
})

test('bounded Electron cleanup does not treat fulfilled close as exit evidence', async () => {
  const calls = []
  const child = new EventEmitter()
  child.pid = 4243
  child.exitCode = null
  child.signalCode = null
  const application = {
    close: async () => { calls.push('close-fulfilled') },
    evaluate: async () => { calls.push('app-exit') },
    process: () => child,
  }

  const result = await bundleBuildIdentity.closeElectronApplicationBounded(application, {
    timeoutMs: 5,
    mainProcessId: 4343,
    processExists: () => !calls.includes('exit-observed'),
    killProcess: (pid) => {
      calls.push(`kill:${pid}`)
      queueMicrotask(() => {
        calls.push('exit-observed')
        child.signalCode = 'SIGKILL'
        child.emit('exit', null, 'SIGKILL')
      })
    },
  })

  assert.deepEqual(calls, ['close-fulfilled', 'app-exit', 'kill:4343', 'exit-observed'])
  assert.deepEqual(result, { forced: true, hardKilled: true, exitObserved: true })
})

test('bounded Electron cleanup returns after app-exit fallback observes child exit', async () => {
  const calls = []
  const child = new EventEmitter()
  child.pid = 4244
  child.exitCode = null
  child.signalCode = null
  const application = {
    close: async () => { throw new Error('close rejected') },
    evaluate: async () => {
      calls.push('app-exit')
      calls.push('exit-observed')
      child.exitCode = 1
      child.emit('exit', 1, null)
    },
    process: () => child,
  }

  const result = await bundleBuildIdentity.closeElectronApplicationBounded(application, {
    timeoutMs: 5,
    mainProcessId: 4344,
    processExists: () => !calls.includes('exit-observed'),
    killProcess: () => { calls.push('hard-kill') },
  })

  assert.deepEqual(calls, ['app-exit', 'exit-observed'])
  assert.deepEqual(result, { forced: true, hardKilled: false, exitObserved: true })
})

test('bounded Electron cleanup fails explicitly when PID kill produces no exit evidence', async () => {
  const child = new EventEmitter()
  child.pid = 4245
  child.exitCode = null
  child.signalCode = null
  const application = {
    close: async () => {},
    evaluate: async () => {},
    process: () => child,
  }

  await assert.rejects(
    () => bundleBuildIdentity.closeElectronApplicationBounded(application, {
      timeoutMs: 5,
      mainProcessId: 4245,
      processExists: () => true,
      killProcess: () => {},
    }),
    /child process 4245 exit was not observed after hard kill/i,
  )
})

test('bounded Electron cleanup observes real child exit and leaves no process residue', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  })
  await once(child, 'spawn')
  const pid = child.pid
  assert.equal(Number.isInteger(pid), true)
  const application = {
    close: async () => { throw new Error('real child has no Electron close channel') },
    evaluate: async () => {},
    process: () => child,
  }

  try {
    const result = await bundleBuildIdentity.closeElectronApplicationBounded(application, {
      timeoutMs: 250,
    })

    assert.deepEqual(result, { forced: true, hardKilled: true, exitObserved: true })
    assert.throws(() => process.kill(pid, 0), /ESRCH|no such process|not found/i)
  } finally {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
})
