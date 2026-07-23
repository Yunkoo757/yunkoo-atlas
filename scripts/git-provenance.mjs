import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export function selectSourceIdentity({ workingTreeDirty, gitTree, sourceFingerprint }) {
  return workingTreeDirty
    ? `dirty-sha256:${sourceFingerprint}`
    : `git-tree:${gitTree}`
}

export async function readGitProvenance(root = process.cwd()) {
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const gitTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim()
  const listed = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  const files = listed.toString('utf8').split('\0').filter(Boolean).sort()
  const hash = createHash('sha256').update(`commit\0${gitCommit}\0`)
  let workingTreeDirty = false

  for (const relativePath of files) {
    hash.update(`path\0${relativePath}\0`)
    try {
      const bytes = await fs.readFile(path.join(root, relativePath))
      hash.update(`bytes\0${bytes.length}\0`)
      hash.update(bytes)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      hash.update('missing\0')
    }
  }

  const sourceStatus = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  workingTreeDirty = sourceStatus.trim().length > 0

  const sourceFingerprint = hash.digest('hex')
  return {
    gitCommit,
    gitTree,
    workingTreeDirty,
    sourceFingerprint,
    sourceIdentity: selectSourceIdentity({ workingTreeDirty, gitTree, sourceFingerprint }),
  }
}
