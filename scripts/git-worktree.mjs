import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readlinkSync, statSync } from 'node:fs'
import path from 'node:path'
import { decodeGitPaths } from './repository-text.mjs'

export function* repositoryEntries(root, { trackedOnly = false, paths = [] } = {}) {
  const args = ['ls-files', '-z', '--cached']
  if (!trackedOnly) args.push('--others', '--exclude-standard')
  const listed = execFileSync('git', [...args, '--', ...paths], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  const names = decodeGitPaths(listed)
  const directories = new Map([['.', true]])

  // A tracked path survives in the index when a parent is replaced by a file or a link.
  function hasDirectory(relative) {
    if (!directories.has(relative)) {
      const parentExists = hasDirectory(path.posix.dirname(relative))
      const stat = parentExists && lstatSync(path.join(root, relative), { throwIfNoEntry: false })
      directories.set(relative, Boolean(stat && stat.isDirectory()))
    }
    return directories.get(relative)
  }

  for (const name of [...new Set(names)].sort()) {
    const absolute = path.join(root, name)
    const stat = hasDirectory(path.posix.dirname(name)) ? lstatSync(absolute, { throwIfNoEntry: false }) : undefined
    let target = stat
    let linkTarget
    if (stat?.isSymbolicLink()) {
      linkTarget = readlinkSync(absolute, { encoding: 'buffer' })
      try {
        target = statSync(absolute, { throwIfNoEntry: false })
      } catch (error) {
        if (error.code !== 'ELOOP' && error.code !== 'ENOTDIR') throw error
        target = undefined
      }
    }
    yield {
      name,
      linkTarget,
      isFile: target?.isFile() === true,
      executable: Boolean(target?.mode & 0o100),
      nestedRepository: stat?.isDirectory() === true && existsSync(path.join(absolute, '.git')),
    }
  }
}

export function listRepositoryFiles(root, options) {
  const files = []
  for (const entry of repositoryEntries(root, options)) {
    if (entry.isFile) files.push(entry.name)
  }
  return files
}
