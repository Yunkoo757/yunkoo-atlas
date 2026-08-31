import fs from 'node:fs'
import path from 'node:path'

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function assertDirectManagedChild(root: string, candidate: string, expectedName: string): void {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    path.basename(resolvedCandidate) !== expectedName ||
    path.dirname(normalizeForComparison(resolvedCandidate)) !== normalizeForComparison(resolvedRoot)
  ) {
    throw new Error(`资料库受管路径越界：${expectedName}`)
  }
  if (!fs.existsSync(resolvedCandidate)) return
  const stat = fs.lstatSync(resolvedCandidate)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`资料库受管目录不是普通目录：${expectedName}`)
  }
  const canonicalRoot = fs.realpathSync.native(resolvedRoot)
  const canonicalCandidate = fs.realpathSync.native(resolvedCandidate)
  const relative = path.relative(canonicalRoot, canonicalCandidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`资料库受管目录指向库外位置：${expectedName}`)
  }
}

export function ensureManagedDirectory(root: string, candidate: string, expectedName: string): void {
  assertDirectManagedChild(root, candidate, expectedName)
  if (!fs.existsSync(candidate)) fs.mkdirSync(candidate)
  assertDirectManagedChild(root, candidate, expectedName)
}

export function clearManagedFlatDirectory(root: string, candidate: string, expectedName: string): void {
  ensureManagedDirectory(root, candidate, expectedName)
  for (const name of fs.readdirSync(candidate)) {
    const entry = path.join(candidate, name)
    const stat = fs.lstatSync(entry)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`受管目录包含不能安全清理的项目：${name}`)
    }
  }
  for (const name of fs.readdirSync(candidate)) fs.rmSync(path.join(candidate, name), { force: true })
}

export function removeDirectManagedDirectory(root: string, candidate: string, expectedName: string): void {
  assertDirectManagedChild(root, candidate, expectedName)
  if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true })
}
