import assert from 'node:assert/strict'
import test from 'node:test'

const visualRunnerModule = await import('../qa-desktop-visual.mjs').catch((importError) => ({ importError }))
const forcedKillRunnerModule = await import('../run-forced-kill-evidence.mjs').catch((importError) => ({ importError }))

const commitA = 'a'.repeat(40)
const commitB = 'b'.repeat(40)

function evidence({ renderer, main, repositoryDirty = false, githubSha = null }) {
  return {
    bundles: { renderer, main },
    repository: { head: commitA, dirty: repositoryDirty },
    ci: { githubSha },
  }
}

function runnerDependencies(bundleIdentity, { cleanupError } = {}) {
  const calls = []
  return {
    calls,
    dependencies: {
      readBundleIdentity: async () => {
        calls.push('read-identity')
        return bundleIdentity
      },
      createLibrary: async () => { calls.push('create-library'); return 'library' },
      seedLibrary: async () => { calls.push('seed-library'); return 'seed' },
      captureEvidence: async () => { calls.push('capture'); return { status: 'pass' } },
      cleanupEvidence: async () => {
        calls.push('cleanup')
        if (cleanupError) throw cleanupError
      },
      writeReport: async (report) => { calls.push('write-report'); return report },
    },
  }
}

const invalidVisualEvidence = [
  {
    label: 'stale renderer',
    value: evidence({
      renderer: { commit: commitB, dirty: false },
      main: { commit: commitA, dirty: false },
    }),
    error: /renderer bundle commit.*repository HEAD/i,
  },
  {
    label: 'dirty main',
    value: evidence({
      renderer: { commit: commitA, dirty: false },
      main: { commit: commitA, dirty: true },
    }),
    error: /main bundle.*dirty/i,
  },
  {
    label: 'GITHUB_SHA mismatch',
    value: evidence({
      renderer: { commit: commitA, dirty: false },
      main: { commit: commitA, dirty: false },
      githubSha: commitB,
    }),
    error: /repository HEAD.*GITHUB_SHA/i,
  },
]

test('Electron visual runner rejects stale dirty and CI-mismatched bundles before every evidence side effect', async () => {
  assert.equal(
    typeof visualRunnerModule.runElectronVisualEvidenceRunner,
    'function',
    visualRunnerModule.importError?.message,
  )
  for (const fixture of invalidVisualEvidence) {
    const probe = runnerDependencies(fixture.value)
    await assert.rejects(
      () => visualRunnerModule.runElectronVisualEvidenceRunner(probe.dependencies),
      fixture.error,
      fixture.label,
    )
    assert.deepEqual(probe.calls, ['read-identity', 'cleanup'], fixture.label)
  }
})

const invalidForcedKillEvidence = [
  {
    label: 'stale main',
    value: evidence({ main: { commit: commitB, dirty: false } }),
    error: /main bundle commit.*repository HEAD/i,
  },
  {
    label: 'dirty main',
    value: evidence({ main: { commit: commitA, dirty: true } }),
    error: /main bundle.*dirty/i,
  },
  {
    label: 'GITHUB_SHA mismatch',
    value: evidence({ main: { commit: commitA, dirty: false }, githubSha: commitB }),
    error: /repository HEAD.*GITHUB_SHA/i,
  },
]

test('forced-kill runner rejects stale dirty and CI-mismatched main before library seed capture or report', async () => {
  assert.equal(
    typeof forcedKillRunnerModule.runForcedKillEvidenceRunner,
    'function',
    forcedKillRunnerModule.importError?.message,
  )
  for (const fixture of invalidForcedKillEvidence) {
    const probe = runnerDependencies(fixture.value)
    await assert.rejects(
      () => forcedKillRunnerModule.runForcedKillEvidenceRunner(probe.dependencies),
      fixture.error,
      fixture.label,
    )
    assert.deepEqual(probe.calls, ['read-identity', 'cleanup'], fixture.label)
  }
})

test('runner writes evidence only after identity validation and all owned side effects complete', async () => {
  assert.equal(typeof visualRunnerModule.runElectronVisualEvidenceRunner, 'function')
  assert.equal(typeof forcedKillRunnerModule.runForcedKillEvidenceRunner, 'function')
  const matching = evidence({
    renderer: { commit: commitA, dirty: false },
    main: { commit: commitA, dirty: false },
  })

  for (const run of [
    visualRunnerModule.runElectronVisualEvidenceRunner,
    forcedKillRunnerModule.runForcedKillEvidenceRunner,
  ]) {
    const probe = runnerDependencies(matching)
    const result = await run(probe.dependencies)
    assert.deepEqual(result, { status: 'pass' })
    assert.deepEqual(probe.calls, [
      'read-identity',
      'create-library',
      'seed-library',
      'capture',
      'cleanup',
      'write-report',
    ])
  }
})

test('runner preserves the original identity failure together with cleanup failure', async () => {
  assert.equal(typeof visualRunnerModule.runElectronVisualEvidenceRunner, 'function')
  const probe = runnerDependencies(invalidVisualEvidence[0].value, {
    cleanupError: new Error('temporary profile cleanup failed'),
  })

  let observed
  try {
    await visualRunnerModule.runElectronVisualEvidenceRunner(probe.dependencies)
  } catch (error) {
    observed = error
  }

  assert(observed instanceof AggregateError)
  assert.deepEqual(observed.errors.map((error) => error.message), [
    'renderer bundle commit must equal repository HEAD',
    'temporary profile cleanup failed',
  ])
  assert.deepEqual(probe.calls, ['read-identity', 'cleanup'])
})
