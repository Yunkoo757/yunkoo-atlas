import { readGitProvenance } from './git-provenance.mjs'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/

function normalizeCommit(value, label) {
  if (typeof value !== 'string' || !COMMIT_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${label} must be a 40-character Git commit`)
  }
  return value.toLowerCase()
}

function normalizeGithubSha(value) {
  if (value == null || value === '') return null
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
    ci: { githubSha: normalizeGithubSha(environment.GITHUB_SHA) },
  }
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

export async function collectElectronBundleIdentity({ page, application, expectation }) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new Error('Electron renderer identity requires a running renderer page')
  }
  if (!application || typeof application.evaluate !== 'function') {
    throw new Error('Electron main identity requires a running Electron application')
  }
  const [renderer, main] = await Promise.all([
    page.evaluate(() => window.__ATLAS_BUILD_IDENTITY__),
    application.evaluate(() => globalThis.__ATLAS_BUILD_IDENTITY__),
  ])
  const evidence = {
    bundles: { renderer, main },
    repository: expectation?.repository,
    ci: expectation?.ci,
  }
  validateBundleBuildIdentityEvidence(evidence, ['renderer', 'main'])
  return evidence
}
