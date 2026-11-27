import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { repositoryEntries } from './git-worktree.mjs'

export function selectSourceIdentity({ workingTreeDirty, gitTree, sourceFingerprint }) {
  return workingTreeDirty
    ? `dirty-sha256:${sourceFingerprint}`
    : `git-tree:${gitTree}`
}

export function hasSameLocalSource(expected, current) {
  return Boolean(expected?.gitCommit && current &&
    expected.gitCommit === current.gitCommit &&
    expected.gitTree === current.gitTree &&
    expected.workingTreeDirty === current.workingTreeDirty &&
    expected.sourceFingerprint === current.sourceFingerprint &&
    expected.sourceIdentity === current.sourceIdentity)
}

export function assertLocalSourceUnchanged(expected, current) {
  if (!hasSameLocalSource(expected, current)) {
    throw new Error('Repository source changed during evidence collection; refusing to publish pass evidence')
  }
}

export async function readGitProvenance(root = process.cwd()) {
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const gitTree = execFileSync('git', ['rev-parse', `${gitCommit}^{tree}`], { cwd: root, encoding: 'utf8' }).trim()
  const hash = createHash('sha256').update(`commit\0${gitCommit}\0`)
  for (const entry of repositoryEntries(root)) {
    hash.update(`path\0${entry.name}\0`)
    if (entry.nestedRepository) throw new Error(`Cannot fingerprint nested Git repository: ${entry.name}`)
    if (entry.linkTarget) {
      hash.update(`link\0${entry.linkTarget.length}\0`)
      hash.update(entry.linkTarget)
    }
    if (!entry.isFile) {
      hash.update('missing\0')
      continue
    }
    if (entry.executable) hash.update('executable\0')
    const bytes = await fs.readFile(path.join(root, entry.name))
    hash.update(`bytes\0${bytes.length}\0`)
    hash.update(bytes)
  }

  const sourceStatus = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  const workingTreeDirty = sourceStatus.trim().length > 0

  const sourceFingerprint = hash.digest('hex')
  return {
    gitCommit,
    gitTree,
    workingTreeDirty,
    sourceFingerprint,
    sourceIdentity: selectSourceIdentity({ workingTreeDirty, gitTree, sourceFingerprint }),
  }
}
