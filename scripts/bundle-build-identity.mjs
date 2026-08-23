import { rmSync } from 'node:fs'

import { readGitProvenance } from './git-provenance.mjs'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/

function normalizeCommit(value, label) {
  if (typeof value !== 'string' || !COMMIT_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${label} must be a 40-character Git commit`)
  }
  return value.toLowerCase()
}

function normalizeGithubSha(value) {
  if (value === null) return null
  return normalizeCommit(value, 'GITHUB_SHA')
}

export async function readRepositoryBuildExpectation(root = process.cwd(), environment = process.env) {
  const provenance = await readGitProvenance(root)
  return {
    repository: {
      head: normalizeCommit(provenance.gitCommit, 'repository HEAD'),
      dirty: provenance.workingTreeDirty,
      tree: provenance.gitTree,
      sourceFingerprint: provenance.sourceFingerprint,
      sourceIdentity: provenance.sourceIdentity,
    },
    ci: {
      githubSha: normalizeGithubSha(
        environment.GITHUB_SHA === undefined ? null : environment.GITHUB_SHA,
      ),
    },
  }
}

export function assertRepositoryProvenanceUnchanged(expectation, provenance) {
  const repository = expectation?.repository
  const unchanged = (
    provenance?.gitCommit?.toLowerCase?.() === repository?.head &&
    provenance?.gitTree === repository?.tree &&
    provenance?.workingTreeDirty === repository?.dirty &&
    provenance?.sourceFingerprint === repository?.sourceFingerprint &&
    provenance?.sourceIdentity === repository?.sourceIdentity
  )
  if (!unchanged) {
    throw new Error('Repository source changed during evidence collection; refusing to publish pass evidence')
  }
}

/** Pass evidence is only publishable after every temporary resource is durably released. */
export async function publishEvidenceAfterCleanup({ cleanup, publish }) {
  if (typeof cleanup !== 'function' || typeof publish !== 'function') {
    throw new Error('Evidence cleanup and publication callbacks are required')
  }
  await cleanup()
  return publish()
}

export function validateBundleBuildIdentityEvidence(evidence, requiredBundles) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('Bundle build identity evidence is required')
  }
  if (!Array.isArray(requiredBundles) || requiredBundles.length === 0) {
    throw new Error('At least one required bundle identity is required')
  }
  const repositoryHead = normalizeCommit(evidence.repository?.head, 'repository HEAD')
  if (evidence.repository?.dirty !== false) {
    throw new Error('Repository working tree is dirty; bundle evidence requires a clean HEAD')
  }
  if (!evidence.ci || typeof evidence.ci !== 'object' || !Object.hasOwn(evidence.ci, 'githubSha')) {
    throw new Error('GITHUB_SHA evidence must be explicit (null for a local run)')
  }
  const githubSha = normalizeGithubSha(evidence.ci?.githubSha)
  if (githubSha && repositoryHead !== githubSha) {
    throw new Error('Repository HEAD must equal the exact GITHUB_SHA')
  }

  for (const bundleName of requiredBundles) {
    const identity = evidence.bundles?.[bundleName]
    if (!identity || typeof identity !== 'object') {
      throw new Error(`${bundleName} bundle identity is missing`)
    }
    const bundleCommit = normalizeCommit(identity.commit, `${bundleName} bundle commit`)
    if (identity.dirty !== false) {
      throw new Error(`${bundleName} bundle is dirty; evidence requires a clean build`)
    }
    if (bundleCommit !== repositoryHead) {
      throw new Error(`${bundleName} bundle commit must equal repository HEAD`)
    }
    if (githubSha && bundleCommit !== githubSha) {
      throw new Error(`${bundleName} bundle commit must equal the exact GITHUB_SHA`)
    }
  }
  return evidence
}

export async function collectElectronBundleIdentity({
  page,
  application,
  expectation,
  identityTimeoutMs = 10_000,
  identityPollIntervalMs = 25,
}) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new Error('Electron renderer identity requires a running renderer page')
  }
  if (!application || typeof application.evaluate !== 'function') {
    throw new Error('Electron main identity requires a running Electron application')
  }
  if (!Number.isFinite(identityTimeoutMs) || identityTimeoutMs <= 0) {
    throw new Error('Electron bundle identity timeout must be a positive number')
  }
  if (!Number.isFinite(identityPollIntervalMs) || identityPollIntervalMs <= 0) {
    throw new Error('Electron bundle identity poll interval must be a positive number')
  }

  const deadline = Date.now() + identityTimeoutMs
  let renderer
  let main
  while (true) {
    const identities = await Promise.all([
      page.evaluate(() => window.__ATLAS_BUILD_IDENTITY__),
      application.evaluate(() => globalThis.__ATLAS_BUILD_IDENTITY__),
    ])
    renderer = identities[0]
    main = identities[1]
    const rendererReady = renderer && typeof renderer === 'object'
    const mainReady = main && typeof main === 'object'
    if (rendererReady && mainReady) break
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(identityPollIntervalMs, remaining))
    })
  }
  const evidence = {
    bundles: { renderer, main },
    repository: expectation?.repository,
    ci: expectation?.ci,
  }
  validateBundleBuildIdentityEvidence(evidence, ['renderer', 'main'])
  return evidence
}

export async function closeElectronApplication(application, timeoutMs = 2_000) {
  return closeElectronApplicationBounded(application, { timeoutMs })
}

export async function removeTemporaryDirectoryBounded(directory, {
  timeoutMs = 10_000,
  retryDelayMs = 100,
  removeDirectory = (target) => rmSync(target, { recursive: true, force: true }),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Temporary directory cleanup timeout must be a positive number')
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    throw new Error('Temporary directory cleanup retry delay must be a positive number')
  }
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await removeDirectory(directory)
      return
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code) || Date.now() >= deadline) {
        throw error
      }
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, Math.min(retryDelayMs, Math.max(1, deadline - Date.now())))
    })
  }
}

export async function closeElectronApplicationBounded(application, {
  timeoutMs = 2_000,
  mainProcessId,
  killProcess = (pid) => process.kill(pid, 'SIGKILL'),
  processExists = (pid) => {
    if (!Number.isInteger(pid)) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  },
} = {}) {
  if (!application) return { forced: false, hardKilled: false, exitObserved: true }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Electron application close timeout must be a positive number')
  }
  const child = application.process?.()
  const targetProcessId = Number.isInteger(mainProcessId) ? mainProcessId : child?.pid
  let exitObserved = typeof child?.exitCode === 'number' || child?.signalCode != null
  const exited = exitObserved
    ? Promise.resolve()
    : new Promise((resolve) => {
        child?.once?.('exit', () => {
          exitObserved = true
          resolve()
        })
      })

  async function settlesWithin(promise) {
    let timer
    const outcome = await Promise.race([
      Promise.resolve(promise).then(() => 'fulfilled', () => 'rejected'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs) }),
    ])
    clearTimeout(timer)
    return outcome
  }

  async function exitObservedWithin() {
    const deadline = Date.now() + timeoutMs
    while (true) {
      let targetExited = false
      try {
        targetExited = !processExists(targetProcessId)
      } catch {}
      if (exitObserved && targetExited) return true
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      const retryDelay = new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)))
      if (exitObserved) await retryDelay
      else await Promise.race([exited, retryDelay])
    }
  }

  let closeOperation
  try {
    closeOperation = application.close()
  } catch {}
  if (closeOperation) await settlesWithin(closeOperation)
  if (await exitObservedWithin()) {
    return { forced: false, hardKilled: false, exitObserved: true }
  }

  let appExit
  try {
    appExit = application.evaluate?.(({ app }) => app.exit(1))
  } catch {}
  if (appExit) await settlesWithin(appExit)
  if (await exitObservedWithin()) {
    return { forced: true, hardKilled: false, exitObserved: true }
  }

  let killError
  try {
    await killProcess(targetProcessId)
  } catch (error) {
    killError = error
  }
  if (!await exitObservedWithin()) {
    const exitError = new Error(
      `Electron cleanup failed: child process ${String(targetProcessId)} exit was not observed after hard kill`,
    )
    if (killError) {
      throw new AggregateError([killError, exitError], 'Electron hard-kill cleanup failed')
    }
    throw exitError
  }
  return { forced: true, hardKilled: true, exitObserved: true }
}
