import path from 'node:path'
import fs from 'node:fs'
import { ensureManagedDirectory } from './managedPaths'

function canonicalDirectory(directory: string): string {
  const resolved = path.resolve(directory)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function isSameDirectory(left: string, right: string): boolean {
  return path.relative(canonicalDirectory(left), canonicalDirectory(right)) === ''
}

export function getLibraryPaths(libraryPath: string): {
  root: string
  attachments: string
  backups: string
  dbFile: string
  manifestFile: string
} {
  const root = path.resolve(libraryPath)
  return {
    root,
    attachments: path.join(root, 'attachments'),
    backups: path.join(root, 'backups'),
    dbFile: path.join(root, 'journal.db'),
    manifestFile: path.join(root, 'manifest.json'),
  }
}

export function ensureLibraryDirs(libraryPath: string): ReturnType<typeof getLibraryPaths> {
  const paths = getLibraryPaths(libraryPath)
  const { root, attachments, backups } = paths
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  const rootStat = fs.statSync(root)
  if (!rootStat.isDirectory()) {
    throw new Error('资料库根路径不是普通目录')
  }
  ensureManagedDirectory(root, attachments, 'attachments')
  ensureManagedDirectory(root, backups, 'backups')
  return paths
}
