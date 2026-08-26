import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const ATTEMPT_PATTERN = /^attempt-[1-9][0-9]*$/

function canonicalPath(value) {
  let probe = resolve(value)
  const suffix = []

  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    suffix.unshift(basename(probe))
    probe = parent
  }

  const canonicalBase = existsSync(probe) ? realpathSync.native(probe) : probe
  const canonical = resolve(canonicalBase, ...suffix)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function isSameOrDescendant(target, root) {
  const delta = relative(canonicalPath(root), canonicalPath(target))
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
}

export function assertCommitAddressableDesktopVisualPath({
  root,
  outputPath,
  expectedCommit,
  allowDescendant = false,
}) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Repository root is required')
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new Error('Desktop visual output path is required')
  }
  const normalizedCommit = String(expectedCommit ?? '').trim().toLowerCase()
  if (!COMMIT_PATTERN.test(normalizedCommit)) {
    throw new Error(`Expected commit must be a full 40 character SHA: ${expectedCommit ?? ''}`)
  }

  const repositoryRoot = resolve(root)
  const evidenceRoot = resolve(repositoryRoot, 'test-results', 'desktop-visual-evidence')
  const target = resolve(repositoryRoot, outputPath)
  if (!isSameOrDescendant(target, evidenceRoot) || canonicalPath(target) === canonicalPath(evidenceRoot)) {
    throw new Error(`Unsafe desktop visual evidence path: ${target}`)
  }

  const delta = relative(repositoryRoot, target)
  const parts = delta.split(sep)
  const requiredLength = allowDescendant ? 6 : 5
  if (parts.length < requiredLength || (!allowDescendant && parts.length !== requiredLength)) {
    throw new Error(`Desktop visual evidence path has an invalid commit/attempt layout: ${target}`)
  }
  if (parts[0] !== 'test-results' || parts[1] !== 'desktop-visual-evidence') {
    throw new Error(`Desktop visual evidence path has an invalid root: ${target}`)
  }
  if (!['baseline', 'candidate'].includes(parts[2])) {
    throw new Error(`Desktop visual evidence path must use baseline or candidate: ${target}`)
  }
  const pathCommit = parts[3].toLowerCase()
  if (!COMMIT_PATTERN.test(pathCommit) || pathCommit !== normalizedCommit) {
    throw new Error(`Desktop visual evidence path commit does not match HEAD: ${target}`)
  }
  if (!ATTEMPT_PATTERN.test(parts[4])) {
    throw new Error(`Desktop visual evidence path must use attempt-N: ${target}`)
  }
  return target
}

export function assertFreshDesktopVisualTargets(targets) {
  for (const target of targets) {
    if (existsSync(target)) {
      throw new Error(`Desktop visual evidence already exists: ${target}`)
    }
  }
}
