import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  closeElectronApplication,
  collectElectronBundleIdentity,
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
